/**
 * Crawler Service
 *
 * Shared primitives for /map (URL discovery) and /crawl (bounded BFS crawl):
 * robots.txt parsing, sitemap parsing, link extraction, and URL normalization.
 *
 * Safety: every URL these helpers emit is filtered through `validateURL()` by
 * the callers before it is fetched, and all fetching goes through `safeFetch`
 * so each redirect hop is revalidated. Link/sitemap discovery is untrusted
 * input — it comes from the crawled page itself.
 */

import { validateURL } from "./validator";

// ============================================
// URL normalization & filtering
// ============================================

/**
 * Canonical form used for dedupe: drop the fragment, drop a trailing slash
 * (except on the root path), and lowercase the host.
 */
export function normalizeUrl(raw: string, base?: string): string | null {
    try {
        const url = base ? new URL(raw, base) : new URL(raw);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return null;
        }
        url.hash = "";
        url.hostname = url.hostname.toLowerCase();
        if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
            url.pathname = url.pathname.slice(0, -1);
        }
        return url.href;
    } catch {
        return null;
    }
}

/** True when `candidate` is on the same host as `origin`. */
export function isSameHost(candidate: string, origin: string): boolean {
    try {
        return new URL(candidate).hostname.toLowerCase() === new URL(origin).hostname.toLowerCase();
    } catch {
        return false;
    }
}

/**
 * Path filter. `include`/`exclude` are plain substrings matched against the
 * path + query — deliberately not regex, so a caller cannot hand us a
 * catastrophic backtracking pattern.
 */
export function matchesPathFilters(
    url: string,
    include: string[] = [],
    exclude: string[] = [],
): boolean {
    let pathAndQuery: string;
    try {
        const u = new URL(url);
        pathAndQuery = u.pathname + u.search;
    } catch {
        return false;
    }
    if (exclude.some((fragment) => pathAndQuery.includes(fragment))) {
        return false;
    }
    if (include.length > 0 && !include.some((fragment) => pathAndQuery.includes(fragment))) {
        return false;
    }
    return true;
}

// ============================================
// robots.txt
// ============================================

export interface RobotsRules {
    /** Disallow patterns for the `*` user-agent group. */
    disallow: string[];
    /** Allow patterns for the `*` user-agent group (override longer Disallow). */
    allow: string[];
    /** Sitemap URLs declared anywhere in the file. */
    sitemaps: string[];
}

export const EMPTY_ROBOTS: RobotsRules = { disallow: [], allow: [], sitemaps: [] };

/**
 * Parse robots.txt, collecting the rules that apply to us (`User-agent: *`).
 * Sitemap directives are file-global and collected regardless of group.
 */
export function parseRobots(text: string): RobotsRules {
    const rules: RobotsRules = { disallow: [], allow: [], sitemaps: [] };
    // A group's rules apply once a `User-agent: *` line opens it; any other
    // agent closes it until the next matching one.
    let inWildcardGroup = false;
    let lastLineWasAgent = false;

    for (const rawLine of text.split(/\r?\n/u)) {
        const line = rawLine.split("#")[0]?.trim() ?? "";
        if (line === "") { continue; }
        const sep = line.indexOf(":");
        if (sep === -1) { continue; }
        const field = line.slice(0, sep).trim().toLowerCase();
        const value = line.slice(sep + 1).trim();

        if (field === "sitemap") {
            if (value) { rules.sitemaps.push(value); }
            continue;
        }
        if (field === "user-agent") {
            // Consecutive user-agent lines share one group.
            inWildcardGroup = lastLineWasAgent ? inWildcardGroup || value === "*" : value === "*";
            lastLineWasAgent = true;
            continue;
        }
        lastLineWasAgent = false;
        if (!inWildcardGroup) { continue; }
        if (field === "disallow" && value !== "") { rules.disallow.push(value); }
        if (field === "allow" && value !== "") { rules.allow.push(value); }
    }
    return rules;
}

/** Convert a robots path pattern (`*` wildcard, `$` anchor) to a regex. */
function robotsPatternToRegex(pattern: string): RegExp {
    const anchored = pattern.endsWith("$");
    const body = anchored ? pattern.slice(0, -1) : pattern;
    // Escape everything, then re-enable the single supported wildcard. No
    // nested quantifiers are constructible this way, so matching stays linear.
    const escaped = body.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/\\\*/gu, "[^]*");
    return new RegExp(`^${escaped}${anchored ? "$" : ""}`, "u");
}

/** Length of the matched pattern, or -1 when it does not match. */
function matchLength(path: string, pattern: string): number {
    try {
        return robotsPatternToRegex(pattern).test(path) ? pattern.length : -1;
    } catch {
        return -1;
    }
}

/**
 * RFC 9309 precedence: the longest matching rule wins; on a tie, Allow beats
 * Disallow. No matching Disallow means allowed.
 */
export function isAllowedByRobots(url: string, rules: RobotsRules): boolean {
    let path: string;
    try {
        const u = new URL(url);
        path = u.pathname + u.search;
    } catch {
        return false;
    }
    let longestDisallow = -1;
    for (const pattern of rules.disallow) {
        longestDisallow = Math.max(longestDisallow, matchLength(path, pattern));
    }
    if (longestDisallow === -1) { return true; }
    let longestAllow = -1;
    for (const pattern of rules.allow) {
        longestAllow = Math.max(longestAllow, matchLength(path, pattern));
    }
    return longestAllow >= longestDisallow;
}

// ============================================
// Link extraction
// ============================================

const HREF_REGEX = /<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/giu;

/**
 * Extract same-host, http(s) links from HTML, normalized and deduped.
 * Skips mailto:/tel:/javascript: and anything that fails SSRF validation.
 */
export function extractLinks(html: string, baseUrl: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    let match: RegExpExecArray | null;
    HREF_REGEX.lastIndex = 0;
    while ((match = HREF_REGEX.exec(html)) !== null) {
        const href = match[1] ?? match[2] ?? match[3];
        if (!href) { continue; }
        const normalized = normalizeUrl(href, baseUrl);
        if (!normalized || seen.has(normalized)) { continue; }
        if (!isSameHost(normalized, baseUrl)) { continue; }
        if (!validateURL(normalized).valid) { continue; }
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}

// ============================================
// Sitemaps
// ============================================

const LOC_REGEX = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/giu;

export interface ParsedSitemap {
    /** Page URLs (from a <urlset> document). */
    urls: string[];
    /** Nested sitemap URLs (from a <sitemapindex> document). */
    sitemaps: string[];
}

/**
 * Parse a sitemap document. A `<sitemapindex>` root means every `<loc>` is a
 * nested sitemap; otherwise they are page URLs.
 */
export function parseSitemap(xml: string): ParsedSitemap {
    const isIndex = /<sitemapindex[\s>]/iu.test(xml);
    const locs: string[] = [];
    let match: RegExpExecArray | null;
    LOC_REGEX.lastIndex = 0;
    while ((match = LOC_REGEX.exec(xml)) !== null) {
        const raw = match[1];
        if (!raw) { continue; }
        const decoded = raw
            .replace(/&amp;/gu, "&")
            .replace(/&lt;/gu, "<")
            .replace(/&gt;/gu, ">")
            .replace(/&quot;/gu, '"')
            .replace(/&apos;/gu, "'");
        const normalized = normalizeUrl(decoded);
        if (normalized && validateURL(normalized).valid) {
            locs.push(normalized);
        }
    }
    return isIndex ? { urls: [], sitemaps: locs } : { urls: locs, sitemaps: [] };
}
