/**
 * Discussions Handler
 * POST /discussions — what Hacker News said about a topic, with aggregates.
 */

import type { Context } from "hono";
import type { z } from "zod/v4";
import { createErrorResponse } from "../middleware/errorHandler";
import type { DiscussionsRequestSchema } from "../schemas";
import { searchDiscussions } from "../services/discussions";
import type { Env } from "../types";

export async function discussionsHandler(c: Context<{ Bindings: Env }>) {
    const requestId = c.get("requestId");

    try {
        const { query, limit, sort } = c.get("validatedBody") as z.infer<typeof DiscussionsRequestSchema>;

        const report = await searchDiscussions(query, limit, sort);

        return c.json({ ...report, discussedAt: new Date().toISOString(), requestId });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        if (message.includes("timeout") || message.includes("aborted")) {
            return c.json(
                createErrorResponse("FETCH_TIMEOUT", "Hacker News search did not respond in time", requestId),
                502,
            );
        }
        return c.json(createErrorResponse("PROVIDER_ERROR", message, requestId), 502);
    }
}
