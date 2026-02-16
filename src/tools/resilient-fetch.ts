/**
 * Resilient Fetch Endpoint Handler
 * Agent Prime — Multi-provider fetch with automatic fallback
 *
 * POST /fetch/resilient ($0.025)
 *
 * Tries WebLens native scraper first, falls back to Firecrawl → Zyte
 * via x402. Response includes which provider handled the request.
 */

import type { Context } from "hono";
import { z } from "zod/v4";
import { resilientFetch } from "../services/provider-registry";
import { validateURL } from "../services/validator";
import type { Env } from "../types";
import { generateRequestId } from "../utils/requestId";

const resilientFetchSchema = z.object({
    url: z.url(),
    timeout: z.number().min(1000).max(30000).default(10000),
});

/**
 * Resilient Fetch endpoint handler
 * POST /fetch/resilient
 */
export async function resilientFetchHandler(c: Context<{ Bindings: Env }>) {
    const requestId = generateRequestId();

    try {
        const body: unknown = await c.req.json();
        const parsed = resilientFetchSchema.safeParse(body);

        if (!parsed.success) {
            return c.json(
                {
                    error: "INVALID_REQUEST",
                    code: "INVALID_REQUEST",
                    message: "Invalid request parameters",
                    requestId,
                    details: parsed.error.issues,
                },
                400,
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
                400,
            );
        }

        const normalizedUrl = urlValidation.normalized ?? url;

        // Execute resilient fetch with provider fallback chain
        const result = await resilientFetch(normalizedUrl, timeout, c.env.CACHE);

        return c.json({
            ...result,
            requestId,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";

        // Check for "all providers failed" errors
        if (message.includes("All") && message.includes("providers failed")) {
            return c.json(
                {
                    error: "FETCH_ALL_PROVIDERS_FAILED",
                    code: "FETCH_ALL_PROVIDERS_FAILED",
                    message,
                    requestId,
                },
                502,
            );
        }

        return c.json(
            {
                error: "INTERNAL_ERROR",
                code: "INTERNAL_ERROR",
                message,
                requestId,
            },
            500,
        );
    }
}
