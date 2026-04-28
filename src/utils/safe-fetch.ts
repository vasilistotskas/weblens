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

import { validateURL } from "../services/validator";

const MAX_REDIRECTS = 5;

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
