/**
 * Resilient Fetch Endpoint Handler
 * Agent Prime — Multi-provider fetch with automatic fallback
 *
 * POST /fetch/resilient ($0.025)
 *
 * Tries the native scraper first, falls back to headless Chromium.
 * Response includes which tier handled the request.
 */

import type { Context } from "hono";
import type { z } from "zod/v4";
import type { FetchRequestSchema } from "../schemas";
import { resilientFetch } from "../services/provider-registry";
import { validateURL } from "../services/validator";
import type { Env } from "../types";

/**
 * Resilient Fetch endpoint handler
 * POST /fetch/resilient
 *
 * Reads `validatedBody` like every other handler — the route registers
 * validateRequest(FetchRequestSchema), so re-parsing here would duplicate
 * work and (as it previously did) drift from the canonical bounds.
 */
export async function resilientFetchHandler(c: Context<{ Bindings: Env }>) {
    const requestId = c.get("requestId");

    try {
        const { url, timeout } = c.get("validatedBody") as z.infer<typeof FetchRequestSchema>;

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
        const result = await resilientFetch(normalizedUrl, timeout, c.env.CACHE, c.env);

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
