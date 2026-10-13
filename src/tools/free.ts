/**
 * Free Tier Endpoint Handlers
 *
 * Rate-limited, truncated fetch without x402 payment. Free routes must never
 * call a paid upstream: this one is a native fetch only.
 */

import type { Context } from "hono";
import { z } from "zod/v4";
import { FREE_TIER } from "../config";
import { classifyFetchError, createErrorResponse } from "../middleware/errorHandler";
import { validateURL } from "../services/validator";
import type { AppEnv, FreeTierMetadata } from "../types";
import { fetchBasicPage } from "./fetch-basic";

// ============================================
// Schemas
// ============================================

// Free-tier request schemas — the canonical contract for these endpoints.
// Validated at the route level (routes/free.ts) and consumed here via
// validatedBody. Bounds intentionally differ from the paid schemas.
export const freeFetchSchema = z.object({
    url: z.url(),
    timeout: z.number().min(1000).max(15000).default(10000),
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

function getRemainingFromContext(c: Context<AppEnv>): number {
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
export async function freeFetch(c: Context<AppEnv>) {
    const requestId = c.get("requestId");
    const remaining = getRemainingFromContext(c);

    try {
        const { url, timeout } = c.get("validatedBody") as z.infer<typeof freeFetchSchema>;

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
        const { code, status, message } = classifyFetchError(error);
        return c.json(createErrorResponse(code, message, requestId), status);
    }
}

