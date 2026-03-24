/**
 * Search Reader Endpoint Handler
 *
 * Zero-friction GET endpoint: GET /s/cloudflare+workers
 * Returns search results with no auth, no payment, no POST body.
 * Same pattern as the /r/ reader endpoint.
 */

import type { Context } from "hono";
import { FREE_TIER } from "../config";
import { searchWeb } from "../services/search";
import type { Env } from "../types";
import { generateRequestId } from "../utils/requestId";

/**
 * GET /s/*
 * Zero-friction search — just append a query and GET results.
 */
export async function searchReaderHandler(c: Context<{ Bindings: Env }>) {
    const requestId = generateRequestId();
    const format = c.req.query("format") ?? "json";

    // Extract query from path: /s/cloudflare+workers → "cloudflare workers"
    const rawQuery = c.req.path.substring(3); // strip "/s/"

    if (!rawQuery) {
        if (format === "text") {
            return c.text(
                "Error: Missing search query\n\nUsage: GET /s/your+search+query\nDocs:  https://api.weblens.dev/docs\n",
                400
            );
        }
        return c.json({
            error: "MISSING_QUERY",
            code: "MISSING_QUERY",
            message: "Append a search query after /s/ — e.g. GET /s/cloudflare+workers",
            requestId,
            usage: "GET /s/cloudflare+workers",
            docs: "https://api.weblens.dev/docs",
        }, 400);
    }

    // Decode the query (+ becomes space, %20 becomes space, etc.)
    const query = decodeURIComponent(rawQuery.replace(/\+/g, " ")).trim();

    if (query.length > 200) {
        if (format === "text") {
            return c.text("Error: Query too long (max 200 characters)\n", 400);
        }
        return c.json({
            error: "QUERY_TOO_LONG",
            code: "QUERY_TOO_LONG",
            message: "Search query must be 200 characters or less",
            requestId,
        }, 400);
    }

    try {
        const maxResults = FREE_TIER.searchMaxResults;

        const results = await searchWeb({
            query,
            limit: maxResults,
            serpApiKey: c.env.SERP_API_KEY,
        });

        // Plain text response
        if (format === "text") {
            const lines = results.map(
                (r, i) => `${String(i + 1)}. ${r.title}\n   ${r.url}\n   ${r.snippet}`
            );
            const text = `Search: ${query}\n\n${lines.join("\n\n")}\n\n---\nSearched by WebLens (api.weblens.dev) | More results: POST /search ($0.005)\n`;
            return c.text(text, 200);
        }

        // JSON response (default)
        return c.json({
            query,
            results,
            searchedAt: new Date().toISOString(),
            requestId,
            _reader: {
                tier: "free",
                maxResults,
                rateLimit: `${String(FREE_TIER.maxRequestsPerHour)}/hour`,
                upgrade: {
                    moreResults: "POST /search ($0.005) — up to 20 results",
                    docs: "https://api.weblens.dev/docs",
                },
            },
        });
    } catch (error) {
        const rawMessage = error instanceof Error ? error.message : "Unknown error";
        console.error(`[SearchReader] Error: ${rawMessage}`);

        const isProviderError = rawMessage.includes("bot detection") || rawMessage.includes("challenge");

        if (format === "text") {
            return c.text(
                isProviderError
                    ? "Error: Search provider temporarily unavailable\n"
                    : "Error: Search request failed\n",
                502
            );
        }
        return c.json({
            error: isProviderError ? "SERVICE_UNAVAILABLE" : "INTERNAL_ERROR",
            code: isProviderError ? "SERVICE_UNAVAILABLE" : "INTERNAL_ERROR",
            message: isProviderError
                ? "Search provider temporarily unavailable"
                : "Search request failed",
            requestId,
        }, isProviderError ? 502 : 500);
    }
}
