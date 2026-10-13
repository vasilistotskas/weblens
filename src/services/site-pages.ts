/**
 * Fetching a site's own pages for analysis (not for resale as content): one
 * capped HTML read with the response headers kept for fingerprinting, plus the
 * social profiles a page links to. Shared by /intel/project and /company.
 */

import { BOT_USER_AGENT } from "../config";
import { readHtmlOrEmpty, safeFetch } from "../utils/safe-fetch";

export interface SitePage {
    url: string;
    /** Where redirects ended; equal to `url` when there were none. */
    finalUrl: string;
    ok: boolean;
    status?: number;
    /** Empty when the page is not HTML or could not be fetched. */
    html: string;
    /** Response headers as "name: value" lines (tech fingerprinting reads them). */
    headers: string[];
}

/** Fetch one page through safeFetch. Never throws: a failure is `ok: false` with no HTML. */
export async function fetchSitePage(url: string, limits: { timeoutMs: number; maxHtmlBytes: number }): Promise<SitePage> {
    try {
        const response = await safeFetch(url, {
            headers: { "User-Agent": BOT_USER_AGENT, Accept: "text/html,application/xhtml+xml,*/*" },
            signal: AbortSignal.timeout(limits.timeoutMs),
        });
        const headers: string[] = [];
        response.headers.forEach((value, name) => { headers.push(`${name}: ${value}`); });
        const contentType = response.headers.get("content-type") ?? "";
        const html = contentType.includes("html") || contentType === ""
            ? await readHtmlOrEmpty(response, limits.maxHtmlBytes)
            : "";
        return { url, finalUrl: response.url === "" ? url : response.url, ok: response.ok, status: response.status, html, headers };
    } catch {
        return { url, finalUrl: url, ok: false, html: "", headers: [] };
    }
}

/** Every href in a page, external ones included, without a DOM. */
export function pageHrefs(html: string): string[] {
    return [...html.matchAll(/href=["']([^"']+)["']/giu)].map((match) => match[1] ?? "");
}

/** Social presences worth reporting, matched against link hrefs. */
const SOCIAL_PATTERNS: [key: string, pattern: RegExp][] = [
    ["twitter", /(?:twitter\.com|x\.com)\/[A-Za-z0-9_]{2,}/u],
    ["telegram", /t\.me\/[A-Za-z0-9_]{3,}/u],
    ["discord", /discord\.(?:gg|com\/invite)\/[A-Za-z0-9]{4,}/u],
    ["github", /github\.com\/[A-Za-z0-9-]{2,}/u],
    ["medium", /medium\.com\/@?[A-Za-z0-9-]{2,}/u],
    ["linkedin", /linkedin\.com\/(?:company|in)\/[A-Za-z0-9-]{2,}/u],
];

/** The first link to each social platform among `hrefs`, as an https URL. */
export function findSocials(hrefs: readonly string[]): Record<string, string> {
    const haystack = hrefs.join(" ");
    const socials: Record<string, string> = {};
    for (const [key, pattern] of SOCIAL_PATTERNS) {
        const hit = pattern.exec(haystack);
        if (hit) { socials[key] = hit[0].startsWith("http") ? hit[0] : `https://${hit[0]}`; }
    }
    return socials;
}
