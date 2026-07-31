/**
 * Crawl Endpoint Handler
 * POST /crawl — bounded, synchronous, same-host BFS crawl returning markdown.
 *
 * Synchronous by design: an async job would need a polling endpoint, which
 * sits badly with x402's one-shot-per-request payment model (the poll is
 * either free — an abuse vector — or charged again). A page-bounded crawl
 * that returns everything in the paid response keeps the payment and the
 * result in the same call. Workers on paid plans allow 10k subrequests per
 * invocation and bill CPU only (not network wait), so a 1-25 page crawl fits
 * comfortably.
 *
 * Safety: same-host only, every discovered URL re-validated against the SSRF
 * rules before fetch, robots.txt honoured by default.
 */

import type { Context } from "hono";
import type { z } from "zod/v4";
import { CRAWL_LIMITS } from "../config";
import { createErrorResponse } from "../middleware/errorHandler";
import type { CrawlRequestSchema } from "../schemas";
import {
    EMPTY_ROBOTS,
    extractLinks,
    isAllowedByRobots,
    isSameHost,
    matchesPathFilters,
    normalizeUrl,
    parseRobots,
} from "../services/crawler";
import { validateURL } from "../services/validator";
import type { Env } from "../types";
import { htmlToMarkdown, extractMetadata } from "../utils/parser";
import { safeFetch } from "../utils/safe-fetch";

const UA = "Mozilla/5.0 (compatible; WebLensBot/1.0; +https://api.weblens.dev)";

interface CrawlPage {
    url: string;
    depth: number;
    status: "success" | "failed";
    title?: string;
    content?: string;
    truncated?: boolean;
    error?: string;
}

interface QueueItem { url: string; depth: number }

interface FetchedPage { title: string; content: string; links: string[] }

async function fetchPage(url: string, timeout: number): Promise<FetchedPage> {
    const response = await safeFetch(url, {
        headers: {
            "User-Agent": UA,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch: ${String(response.status)} ${response.statusText}`);
    }
    // Only parse HTML — a PDF or image would produce garbage markdown.
    const contentType = response.headers.get("Content-Type") ?? "";
    if (contentType !== "" && !/\b(?:text\/html|application\/xhtml\+xml|text\/plain)\b/iu.test(contentType)) {
        throw new Error(`Unsupported content type: ${contentType.split(";")[0] ?? contentType}`);
    }
    const html = await response.text();
    return {
        title: extractMetadata(html).title ?? "",
        content: htmlToMarkdown(html),
        links: extractLinks(html, url),
    };
}

export async function crawlHandler(c: Context<{ Bindings: Env }>) {
    const requestId = c.get("requestId");

    try {
        const { url, limit, maxDepth, include, exclude, respectRobots, maxChars, timeout } =
            c.get("validatedBody") as z.infer<typeof CrawlRequestSchema>;

        const validation = validateURL(url);
        if (!validation.valid) {
            return c.json(
                createErrorResponse("INVALID_URL", validation.error ?? "Invalid URL", requestId),
                400,
            );
        }
        const start = normalizeUrl(validation.normalized ?? url);
        if (!start) {
            return c.json(createErrorResponse("INVALID_URL", "Invalid URL", requestId), 400);
        }
        const origin = new URL(start).origin;

        // robots.txt — fetched once, applied to every candidate URL.
        let robots = EMPTY_ROBOTS;
        if (respectRobots) {
            try {
                const response = await safeFetch(`${origin}/robots.txt`, {
                    headers: { "User-Agent": UA, Accept: "text/plain" },
                    signal: AbortSignal.timeout(timeout),
                });
                if (response.ok) {
                    robots = parseRobots(await response.text());
                }
            } catch {
                // No robots.txt (or unreachable) → nothing is disallowed.
            }
        }
        if (respectRobots && !isAllowedByRobots(start, robots)) {
            return c.json(
                createErrorResponse("FORBIDDEN", "robots.txt disallows crawling this URL. Set respectRobots=false only for sites you control.", requestId),
                403,
            );
        }

        const pages: CrawlPage[] = [];
        const queued = new Set<string>([start]);
        let frontier: QueueItem[] = [{ url: start, depth: 0 }];
        let discovered = 0;

        while (frontier.length > 0 && pages.length < limit) {
            // Process the frontier in bounded-concurrency batches so a wide
            // site cannot open hundreds of simultaneous subrequests.
            const batch = frontier.splice(0, CRAWL_LIMITS.concurrency)
                .slice(0, Math.max(0, limit - pages.length));
            if (batch.length === 0) { break; }

            const results = await Promise.allSettled(batch.map((item) => fetchPage(item.url, timeout)));

            const nextFrontier: QueueItem[] = [];
            results.forEach((outcome, i) => {
                const item = batch[i];
                if (!item) { return; }
                if (outcome.status === "rejected") {
                    const reason = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
                    pages.push({ url: item.url, depth: item.depth, status: "failed", error: reason });
                    return;
                }
                const page = outcome.value;
                const truncated = page.content.length > maxChars;
                pages.push({
                    url: item.url,
                    depth: item.depth,
                    status: "success",
                    title: page.title,
                    content: truncated ? page.content.slice(0, maxChars) : page.content,
                    truncated,
                });

                if (item.depth >= maxDepth) { return; }
                for (const link of page.links) {
                    if (queued.size >= CRAWL_LIMITS.maxQueued) { break; }
                    if (queued.has(link)) { continue; }
                    if (!isSameHost(link, origin)) { continue; }
                    if (!matchesPathFilters(link, include, exclude)) { continue; }
                    if (!validateURL(link).valid) { continue; }
                    if (respectRobots && !isAllowedByRobots(link, robots)) { continue; }
                    queued.add(link);
                    discovered++;
                    nextFrontier.push({ url: link, depth: item.depth + 1 });
                }
            });

            frontier = [...frontier, ...nextFrontier];
        }

        const successful = pages.filter((p) => p.status === "success").length;
        return c.json({
            url: start,
            pages,
            summary: {
                crawled: pages.length,
                successful,
                failed: pages.length - successful,
                discovered,
                limit,
                maxDepth,
                robotsRespected: respectRobots,
            },
            crawledAt: new Date().toISOString(),
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
