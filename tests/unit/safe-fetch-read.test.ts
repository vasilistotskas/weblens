/**
 * Bounded body reads for user-supplied URLs (src/utils/safe-fetch.ts).
 *
 * Production regression: GET /r/<zenodo .csv.gz> downloaded a 33MB gzip that
 * the origin labels `text/plain`, spent ~28s on it, and served the compressed
 * bytes back as "content". The header alone cannot catch that, so the readers
 * sniff for binary and stream to a hard cap instead of buffering the body.
 */

import { describe, expect, it } from "vitest";
import { classifyFetchError, getErrorCode, getHttpStatus } from "../../src/middleware/errorHandler";
import {
    assertTargetOk,
    HTML_CONTENT_TYPE,
    readDocument,
    readHtmlOrEmpty,
    readTextCapped,
    TargetHttpError,
    UnsupportedContentError,
} from "../../src/utils/safe-fetch";

const GZIP_HEAD = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03]);

/** A response whose body arrives in `chunks`, recording whether the reader cancelled it. */
function streamed(chunks: Uint8Array[], contentType?: string) {
    let cancelled = false;
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            const next = chunks[pulled++];
            if (next) controller.enqueue(next);
            else controller.close();
        },
        cancel() { cancelled = true; },
    });
    const headers = contentType === undefined ? undefined : { "Content-Type": contentType };
    return { response: new Response(body, { headers }), wasCancelled: () => cancelled, pulled: () => pulled };
}

const text = (s: string) => new TextEncoder().encode(s);

describe("readTextCapped", () => {
    it("returns a text body unchanged", async () => {
        await expect(readTextCapped(new Response("<h1>héllo</h1>"))).resolves.toBe("<h1>héllo</h1>");
    });

    it("rejects binary served as text/plain (gzip magic + NUL)", async () => {
        const { response } = streamed([GZIP_HEAD], "text/plain; charset=utf-8");
        await expect(readTextCapped(response)).rejects.toBeInstanceOf(UnsupportedContentError);
    });

    it("truncates at the cap and stops pulling the rest of the body", async () => {
        const chunk = text("a".repeat(1000));
        const { response, wasCancelled, pulled } = streamed(Array.from({ length: 100 }, () => chunk));
        const body = await readTextCapped(response, 2500);
        expect(body).toHaveLength(2500);
        expect(pulled()).toBeLessThan(10);
        expect(wasCancelled()).toBe(true);
    });

    it("only sniffs the head: a NUL deep inside a large text body is not treated as binary", async () => {
        const head = text("x".repeat(9000));
        const tail = new Uint8Array([0x41, 0x00, 0x42]);
        const { response } = streamed([head, tail]);
        await expect(readTextCapped(response)).resolves.toHaveLength(9003);
    });

    it("reads an empty body as an empty string", async () => {
        await expect(readTextCapped(new Response(null))).resolves.toBe("");
    });
});

describe("readDocument", () => {
    it.each([
        "text/html; charset=utf-8",
        "text/plain",
        "application/xhtml+xml",
        "application/xml",
        "application/rss+xml",
        "application/json",
        "application/ld+json",
    ])("accepts %s", async (contentType) => {
        const { response } = streamed([text("<doc/>")], contentType);
        await expect(readDocument(response)).resolves.toBe("<doc/>");
    });

    it("accepts a missing Content-Type and relies on sniffing", async () => {
        const { response } = streamed([text("plain")]);
        await expect(readDocument(response)).resolves.toBe("plain");
    });

    it.each(["application/pdf", "application/octet-stream", "image/png", "application/gzip", "application/zip"])(
        "rejects %s and cancels the body instead of downloading it",
        async (contentType) => {
            const { response, wasCancelled } = streamed([text("ignored")], contentType);
            await expect(readDocument(response)).rejects.toThrow(/Unsupported content type/);
            expect(wasCancelled()).toBe(true);
        },
    );
});

describe("readDocument with HTML_CONTENT_TYPE (crawl)", () => {
    it("accepts HTML and rejects JSON, which has no links to follow", async () => {
        await expect(readDocument(streamed([text("<a/>")], "text/html; charset=utf-8").response, HTML_CONTENT_TYPE)).resolves.toBe("<a/>");
        await expect(readDocument(streamed([text("{}")], "application/json").response, HTML_CONTENT_TYPE)).rejects.toBeInstanceOf(UnsupportedContentError);
    });
});

describe("assertTargetOk", () => {
    it("passes a 2xx through untouched", async () => {
        const { response, wasCancelled } = streamed([text("ok")]);
        await expect(assertTargetOk(response)).resolves.toBeUndefined();
        expect(wasCancelled()).toBe(false);
    });

    it("cancels the unread body and throws TargetHttpError for a non-2xx", async () => {
        let cancelled = false;
        const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
        const response = new Response(body, { status: 403, statusText: "Forbidden" });
        await expect(assertTargetOk(response)).rejects.toMatchObject({ name: "TargetHttpError", status: 403 });
        expect(cancelled).toBe(true);
    });
});

describe("readHtmlOrEmpty", () => {
    it("yields an empty string for binary instead of failing the analysis", async () => {
        const { response } = streamed([GZIP_HEAD], "text/html");
        await expect(readHtmlOrEmpty(response, 1000)).resolves.toBe("");
    });
});

describe("classifyFetchError", () => {
    it.each([
        [new TargetHttpError(403, "Forbidden"), "FETCH_FAILED", 502],
        [new UnsupportedContentError("Unsupported content type: image/png"), "UNSUPPORTED_CONTENT", 422],
        [new Error("The operation was aborted due to timeout"), "FETCH_TIMEOUT", 502],
        [new Error("Redirect to blocked URL: internal"), "REDIRECT_BLOCKED", 400],
        [new Error("something of ours broke"), "INTERNAL_ERROR", 500],
    ] as const)("%s -> %s %i", (error, code, status) => {
        expect(classifyFetchError(error)).toMatchObject({ code, status });
    });

    it("blames the target, not us, for a target HTTP error", () => {
        expect(classifyFetchError(new TargetHttpError(404, "Not Found")).message).toBe("Failed to fetch: target returned 404 Not Found");
    });
});

describe("error envelope mapping", () => {
    it("maps both reader rejections to UNSUPPORTED_CONTENT / 422", () => {
        for (const message of [
            "Unsupported content type: application/pdf",
            "Unsupported content: target returned binary data, not a text document",
        ]) {
            expect(getErrorCode(message)).toBe("UNSUPPORTED_CONTENT");
        }
        expect(getHttpStatus("UNSUPPORTED_CONTENT")).toBe(422);
    });
});
