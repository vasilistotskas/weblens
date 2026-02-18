/**
 * Free Tier Endpoint Handlers
 *
 * Provides rate-limited, truncated access to fetch and search
 * without requiring x402 payment. Reuses existing handler logic.
 */

import type { Context } from "hono";
import { z } from "zod/v4";
import { FREE_TIER } from "../config";
import { createErrorResponse } from "../middleware/errorHandler";
import { validateURL } from "../services/validator";
import type { Env, FreeTierMetadata } from "../types";
import { generateRequestId } from "../utils/requestId";
import { fetchBasicPage } from "./fetch-basic";

// ============================================
// Schemas
// ============================================

const freeFetchSchema = z.object({
    url: z.url(),
    timeout: z.number().min(1000).max(15000).default(10000),
});

const freeSearchSchema = z.object({
    query: z.string().min(1).max(200),
});

// ============================================
// Helpers
// ============================================

function buildFreeTierMeta(
    remaining: number,
    limits: FreeTierMetadata["limits"]
): FreeTierMetadata {
    return {
        tier: "free",
        limits,
        remainingRequests: remaining,
        upgradeUrl: "https://api.weblens.dev/docs",
        message:
            "You're using the free tier. Upgrade to paid endpoints for full content, higher limits, and more features.",
    };
}

function getRemainingFromContext(c: Context<{ Bindings: Env }>): number {
    try {
        const val = c.get("rateLimitRemaining" as never);
        return typeof val === "number" ? val : FREE_TIER.maxRequestsPerHour;
    } catch {
        return FREE_TIER.maxRequestsPerHour;
    }
}

// ============================================
// Free Fetch Handler
// ============================================

/**
 * POST /free/fetch
 * Free tier fetch — truncated content, rate limited.
 */
export async function freeFetch(c: Context<{ Bindings: Env }>) {
    const requestId = generateRequestId();
    const remaining = getRemainingFromContext(c);

    try {
        const body: unknown = await c.req.json();
        const parsed = freeFetchSchema.safeParse(body);

        if (!parsed.success) {
            return c.json(
                {
                    error: "INVALID_REQUEST",
                    code: "INVALID_REQUEST",
                    message: "Invalid request parameters",
                    requestId,
                    details: parsed.error.issues,
                },
                400
            );
        }

        const { url, timeout } = parsed.data;

        // Validate URL
        const urlValidation = validateURL(url);
        if (!urlValidation.valid) {
            return c.json(
                {
                    error: "INVALID_URL",
                    code: "INVALID_URL",
                    message: urlValidation.error ?? "Invalid URL",
                    requestId,
                },
                400
            );
        }

        // Reuse existing fetch logic
        const result = await fetchBasicPage(
            urlValidation.normalized ?? url,
            timeout
        );

        // Truncate content
        const maxLen = FREE_TIER.fetchMaxContentLength;
        const isTruncated = result.content.length > maxLen;
        const content = isTruncated
            ? result.content.slice(0, maxLen) + "\n\n--- Content truncated (free tier) ---"
            : result.content;

        return c.json({
            url: result.url,
            title: result.title,
            content,
            metadata: result.metadata,
            tier: "free" as const,
            fetchedAt: result.fetchedAt,
            truncated: isTruncated,
            requestId,
            _freeTier: buildFreeTierMeta(remaining, {
                contentLength: maxLen,
                requestsPerHour: FREE_TIER.maxRequestsPerHour,
            }),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";

        if (message.includes("timeout") || message.includes("aborted")) {
            return c.json(
                {
                    error: "FETCH_TIMEOUT",
                    code: "FETCH_TIMEOUT",
                    message: "Target URL failed to respond within timeout period",
                    requestId,
                },
                502
            );
        }

        return c.json(
            {
                error: "INTERNAL_ERROR",
                code: "INTERNAL_ERROR",
                message,
                requestId,
            },
            500
        );
    }
}

// ============================================
// Free Search Handler
// ============================================

/**
 * POST /free/search
 * Free tier search — capped results, rate limited.
 */
export async function freeSearch(c: Context<{ Bindings: Env }>) {
    const requestId = generateRequestId();
    const remaining = getRemainingFromContext(c);

    try {
        const body: unknown = await c.req.json();
        const parsed = freeSearchSchema.safeParse(body);

        if (!parsed.success) {
            return c.json(
                {
                    error: "INVALID_REQUEST",
                    code: "INVALID_REQUEST",
                    message: "Invalid request parameters",
                    requestId,
                    details: parsed.error.issues,
                },
                400
            );
        }

        const { query } = parsed.data;
        const maxResults = FREE_TIER.searchMaxResults;

        // Use DuckDuckGo HTML search (same as paid search)
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

        const response = await fetch(searchUrl, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                Accept: "text/html",
            },
        });

        if (!response.ok) {
            return c.json(createErrorResponse("SERVICE_UNAVAILABLE", "Search provider failed", requestId), 502);
        }

        const html = await response.text();
        const allResults = parseDuckDuckGoResultsFree(html, maxResults);

        return c.json({
            query,
            results: allResults,
            searchedAt: new Date().toISOString(),
            requestId,
            _freeTier: buildFreeTierMeta(remaining, {
                maxResults,
                requestsPerHour: FREE_TIER.maxRequestsPerHour,
            }),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return c.json(createErrorResponse("INTERNAL_ERROR", message, requestId), 500);
    }
}

// ============================================
// DuckDuckGo Parser (inline to avoid coupling)
// ============================================

interface FreeSearchResult {
    title: string;
    url: string;
    snippet: string;
    position: number;
}

function parseDuckDuckGoResultsFree(
    html: string,
    limit: number
): FreeSearchResult[] {
    const results: FreeSearchResult[] = [];
    const resultRegex =
        /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]*)<\/a>/gi;

    let match;
    let position = 1;

    while ((match = resultRegex.exec(html)) !== null && results.length < limit) {
        const [, url, title, snippet] = match;
        if (url && title) {
            results.push({
                title: decodeEntities(title.trim()),
                url: decodeURIComponent(url),
                snippet: decodeEntities(snippet.trim()),
                position: position++,
            });
        }
    }

    return results;
}

function decodeEntities(text: string): string {
    return text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ");
}
