/**
 * Browser page hardening for user-supplied URLs.
 *
 * `validateURL()` only vets the URL the client submitted. Once Chromium takes
 * over (via Cloudflare Browser Rendering), it follows redirect chains and
 * loads subresources on its own — none of which pass through `safeFetch()`'s
 * per-hop revalidation. Without interception, a public URL that 302s to
 * 169.254.169.254 (or embeds internal resources) becomes an SSRF vector on
 * the browser-rendered endpoints.
 */

import type { HTTPRequest, Page } from "@cloudflare/puppeteer";
import { validateURL } from "../services/validator";

/**
 * Decide whether an intercepted browser request may proceed. Non-network
 * schemes (data:, blob:, about:) cannot reach internal hosts, so only
 * http(s) URLs are checked against the SSRF rules.
 */
export function isAllowedBrowserRequest(url: string): boolean {
    if (!/^https?:\/\//i.test(url)) {
        return true;
    }
    return validateURL(url).valid;
}

/**
 * Enable request interception on a page so every request — the initial
 * navigation, every redirect hop, and every subresource — is validated
 * against the same SSRF rules as the originally submitted URL. Blocked
 * requests are aborted; a blocked main-frame navigation surfaces as a
 * `net::ERR_FAILED` navigation error to the caller.
 */
export async function hardenPage(page: Page): Promise<void> {
    await page.setRequestInterception(true);
    page.on("request", (request: HTTPRequest) => {
        if (request.isInterceptResolutionHandled()) {
            return;
        }
        if (isAllowedBrowserRequest(request.url())) {
            void request.continue();
        } else {
            void request.abort();
        }
    });
}
