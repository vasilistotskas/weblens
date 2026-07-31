/**
 * Map Endpoint Handler
 * POST /map — discover a site's URLs without fetching page content.
 *
 * Strategy: robots.txt Sitemap: directives → /sitemap.xml → nested sitemap
 * indexes (bounded) → homepage link extraction as a fallback. Cheap: a
 * handful of subrequests regardless of site size.
 */

import type { Context } from "hono";
import type { z } from "zod/v4";
import { CRAWL_LIMITS } from "../config";
import { createErrorResponse } from "../middleware/errorHandler";
import type { MapRequestSchema } from "../schemas";
import {
    EMPTY_ROBOTS,
    extractLinks,
    isSameHost,
    matchesPathFilters,
    normalizeUrl,
    parseRobots,
    parseSitemap,
} from "../services/crawler";
import { validateURL } from "../services/validator";
import type { Env } from "../types";
import { safeFetch } from "../utils/safe-fetch";

const UA = "Mozilla/5.0 (compatible; WebLensBot/1.0; +https://api.weblens.dev)";

async function fetchText(url: string, timeout: number): Promise<string | null> {
    try {
        const response = await safeFetch(url, {
            headers: { "User-Agent": UA, Accept: "*/*" },
            signal: AbortSignal.timeout(timeout),
        });
        if (!response.ok) { return null; }
        return await response.text();
    } catch {
        return null;
    }
}

export async function mapHandler(c: Context<{ Bindings: Env }>) {
    const requestId = c.get("requestId");

    try {
        const { url, limit, include, exclude, timeout } =
            c.get("validatedBody") as z.infer<typeof MapRequestSchema>;

        const validation = validateURL(url);
        if (!validation.valid) {
            return c.json(
                createErrorResponse("INVALID_URL", validation.error ?? "Invalid URL", requestId),
                400,
            );
        }
        const origin = new URL(validation.normalized ?? url).origin;

        // 1. robots.txt — for its Sitemap: directives (not for filtering here;
        //    /map only lists URLs, it does not fetch page content).
        const robotsText = await fetchText(`${origin}/robots.txt`, timeout);
        const robots = robotsText ? parseRobots(robotsText) : EMPTY_ROBOTS;

        // 2. Sitemaps: declared ones first, then the conventional location.
        const queue: string[] = [];
        for (const sitemapUrl of robots.sitemaps) {
            const normalized = normalizeUrl(sitemapUrl);
            if (normalized && isSameHost(normalized, origin) && validateURL(normalized).valid) {
                queue.push(normalized);
            }
        }
        if (queue.length === 0) {
            queue.push(`${origin}/sitemap.xml`);
        }

        const discovered = new Set<string>();
        const visitedSitemaps = new Set<string>();
        let source: "sitemap" | "links" | "none" = "none";

        while (queue.length > 0 && visitedSitemaps.size < CRAWL_LIMITS.maxSitemapDocs && discovered.size < limit) {
            const sitemapUrl = queue.shift();
            if (!sitemapUrl || visitedSitemaps.has(sitemapUrl)) { continue; }
            visitedSitemaps.add(sitemapUrl);

            const xml = await fetchText(sitemapUrl, timeout);
            if (!xml) { continue; }
            const parsed = parseSitemap(xml);
            for (const nested of parsed.sitemaps) {
                if (isSameHost(nested, origin) && !visitedSitemaps.has(nested)) {
                    queue.push(nested);
                }
            }
            for (const pageUrl of parsed.urls) {
                if (discovered.size >= limit) { break; }
                if (!isSameHost(pageUrl, origin)) { continue; }
                if (!matchesPathFilters(pageUrl, include, exclude)) { continue; }
                discovered.add(pageUrl);
                source = "sitemap";
            }
        }

        // 3. Fallback: no sitemap coverage → extract links from the entry page.
        if (discovered.size === 0) {
            const html = await fetchText(validation.normalized ?? url, timeout);
            if (html) {
                for (const link of extractLinks(html, validation.normalized ?? url)) {
                    if (discovered.size >= limit) { break; }
                    if (!matchesPathFilters(link, include, exclude)) { continue; }
                    discovered.add(link);
                    source = "links";
                }
            }
        }

        return c.json({
            url: validation.normalized ?? url,
            urls: Array.from(discovered),
            total: discovered.size,
            source,
            sitemapsChecked: visitedSitemaps.size,
            mappedAt: new Date().toISOString(),
            requestId,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        if (message.includes("timeout") || message.includes("aborted")) {
            return c.json(
                createErrorResponse("FETCH_TIMEOUT", "Target site failed to respond within timeout period", requestId),
                502,
            );
        }
        return c.json(createErrorResponse("INTERNAL_ERROR", message, requestId), 500);
    }
}
