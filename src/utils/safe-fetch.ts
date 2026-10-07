/**
 * SSRF-safe fetch wrapper.
 *
 * Wraps the native `fetch()` with manual redirect handling: every hop of a
 * redirect chain is revalidated against `validateURL()` before the next
 * request goes out. Prevents an attacker from bouncing a validated URL
 * through an attacker-controlled redirect into an internal IP (e.g., the
 * cloud metadata service).
 *
 * Use this anywhere the Worker fetches a URL derived from user input.
 */

import { FETCH_LIMITS } from "../config";
import { validateURL } from "../services/validator";

const MAX_REDIRECTS = 5;

/** Textual content types (HTML, plain text, XML/RSS, JSON). A missing header is accepted and sniffed. */
const TEXT_CONTENT_TYPE = /^\s*(?:text\/[\w.+-]+|application\/(?:xml|json|[\w.-]+\+(?:xml|json)))\s*(?:;|$)/iu;

/** HTML pages only (plus text/plain), for consumers that parse links and markup. */
export const HTML_CONTENT_TYPE = /^\s*(?:text\/html|application\/xhtml\+xml|text\/plain)\s*(?:;|$)/iu;

/** Bytes inspected for a NUL — text never contains one; compressed and binary data almost always does early. */
const BINARY_SNIFF_BYTES = 8192;

/** The target answered with a non-2xx status — the target's failure, not ours (502, not 500). */
export class TargetHttpError extends Error {
    constructor(readonly status: number, statusText: string) {
        super(`Failed to fetch: target returned ${String(status)} ${statusText}`.trimEnd());
        this.name = "TargetHttpError";
    }
}

/**
 * Throw {@link TargetHttpError} for a non-2xx response, cancelling its unread
 * body first so the subrequest's memory is released (per Workers guidance).
 */
export async function assertTargetOk(response: Response): Promise<void> {
    if (response.ok) {
        return;
    }
    await response.body?.cancel().catch(() => undefined);
    throw new TargetHttpError(response.status, response.statusText);
}

/** The target served something that is not a text document (binary, archive, image, PDF...). */
export class UnsupportedContentError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UnsupportedContentError";
    }
}

/**
 * Read a fetched response body as text, bounded to `maxBytes`.
 *
 * Streams the body and cancels it at the cap rather than buffering it whole, and
 * rejects binary bodies by sniffing for a NUL byte — servers mislabel archives
 * as `text/plain` (zenodo serves .csv.gz that way), so the header alone is not
 * enough. A body over the cap is truncated, not rejected: the head of an
 * oversized page is still the useful part.
 */
export async function readTextCapped(
    response: Response,
    maxBytes: number = FETCH_LIMITS.maxDocumentBytes,
): Promise<string> {
    if (!response.body) {
        return "";
    }
    // workers-types declares `ReadableStream<R = any>`; read as unknown and narrow.
    const reader: ReadableStreamDefaultReader<unknown> = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let sniffed = 0;
    try {
        while (total < maxBytes) {
            const result = await reader.read();
            if (result.done) {
                break;
            }
            const value = result.value;
            if (!(value instanceof Uint8Array)) {
                throw new TypeError("Response body yielded a non-byte chunk");
            }
            const chunk = total + value.byteLength > maxBytes ? value.subarray(0, maxBytes - total) : value;
            if (sniffed < BINARY_SNIFF_BYTES) {
                const window = chunk.subarray(0, BINARY_SNIFF_BYTES - sniffed);
                if (window.includes(0)) {
                    throw new UnsupportedContentError("Unsupported content: target returned binary data, not a text document");
                }
                sniffed += window.byteLength;
            }
            chunks.push(chunk);
            total += chunk.byteLength;
        }
    } finally {
        await reader.cancel().catch(() => undefined);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}

/**
 * Best-effort HTML read for analyzers (tech fingerprinting, audits) that treat
 * the body as optional evidence: a binary body yields "" instead of failing the
 * whole analysis, since the response headers alone still carry signal.
 */
export async function readHtmlOrEmpty(response: Response, maxBytes: number): Promise<string> {
    try {
        return await readTextCapped(response, maxBytes);
    } catch (error) {
        if (error instanceof UnsupportedContentError) {
            return "";
        }
        throw error;
    }
}

/**
 * Read a fetched response as a text document: rejects content types outside
 * `accept` (by default anything non-textual — images, PDFs, archives,
 * octet-stream) without downloading the body, then reads via {@link readTextCapped}.
 */
export async function readDocument(
    response: Response,
    accept: RegExp = TEXT_CONTENT_TYPE,
): Promise<string> {
    const contentType = response.headers.get("Content-Type") ?? "";
    if (contentType !== "" && !accept.test(contentType)) {
        await response.body?.cancel().catch(() => undefined);
        throw new UnsupportedContentError(`Unsupported content type: ${contentType.split(";")[0] ?? contentType}`);
    }
    return readTextCapped(response);
}

export async function safeFetch(
    url: string,
    init: RequestInit = {},
    redirectCount = 0
): Promise<Response> {
    const response = await fetch(url, { ...init, redirect: "manual" });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirectCount >= MAX_REDIRECTS) {
            throw new Error("Too many redirects");
        }
        const location = response.headers.get("Location");
        if (!location) {
            throw new Error("Redirect with no Location header");
        }
        const resolved = new URL(location, url).href;
        const validation = validateURL(resolved);
        if (!validation.valid) {
            throw new Error(`Redirect to blocked URL: ${validation.error ?? "internal"}`);
        }
        return safeFetch(validation.normalized ?? resolved, init, redirectCount + 1);
    }

    return response;
}
