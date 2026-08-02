/**
 * Technology Detection Handler
 * POST /tech — what a site is built and run on, from one fetch.
 */

import type { Context } from "hono";
import type { z } from "zod/v4";
import { createErrorResponse } from "../middleware/errorHandler";
import type { TechRequestSchema } from "../schemas";
import { detectTech } from "../services/tech-detect";
import { validateURL } from "../services/validator";
import type { Env } from "../types";

export async function techHandler(c: Context<{ Bindings: Env }>) {
    const requestId = c.get("requestId");

    try {
        const { url } = c.get("validatedBody") as z.infer<typeof TechRequestSchema>;

        const validation = validateURL(url);
        if (!validation.valid) {
            return c.json(
                createErrorResponse("INVALID_URL", validation.error ?? "Invalid URL", requestId),
                400,
            );
        }

        const report = await detectTech(validation.normalized ?? url);

        return c.json({ ...report, detectedAt: new Date().toISOString(), requestId });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        if (message.includes("timeout") || message.includes("aborted")) {
            return c.json(
                createErrorResponse("FETCH_TIMEOUT", "Target site failed to respond within timeout period", requestId),
                502,
            );
        }
        return c.json(createErrorResponse("FETCH_FAILED", message, requestId), 502);
    }
}
