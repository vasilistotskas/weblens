/**
 * Deep Research Endpoint Handler
 * POST /research/deep — multi-step cited research in one synchronous call.
 *
 * Priced per depth tier (PRICING.deepResearch); the tier also fixes the
 * bounds that keep the upstream cost under the price.
 */

import type { Context } from "hono";
import type { z } from "zod/v4";
import { createErrorResponse } from "../middleware/errorHandler";
import type { DeepResearchRequestSchema } from "../schemas";
import { isAIAvailable, handleAIError, AIUnavailableError } from "../services/ai";
import { deepResearch } from "../services/deep-research";
import type { Env } from "../types";

export async function deepResearchHandler(c: Context<{ Bindings: Env }>) {
    const requestId = c.get("requestId");

    try {
        const { query, depth } = c.get("validatedBody") as z.infer<typeof DeepResearchRequestSchema>;

        if (!isAIAvailable(c.env.ANTHROPIC_API_KEY)) {
            return c.json(
                createErrorResponse("AI_UNAVAILABLE", "AI service not configured. Set ANTHROPIC_API_KEY for deep research.", requestId),
                503,
            );
        }

        const result = await deepResearch({
            query,
            depth,
            aiConfig: { apiKey: c.env.ANTHROPIC_API_KEY },
            serpApiKey: c.env.SERP_API_KEY,
        });

        return c.json({
            ...result,
            researchedAt: new Date().toISOString(),
            requestId,
        });
    } catch (error) {
        if (error instanceof AIUnavailableError) {
            const aiError = handleAIError(error);
            return c.json(
                createErrorResponse(aiError.code as "AI_UNAVAILABLE", aiError.message, requestId),
                aiError.status as 503,
            );
        }
        const message = error instanceof Error ? error.message : "Unknown error";
        if (message.includes("No web sources")) {
            return c.json(
                createErrorResponse("NOT_FOUND", "No web sources found for this query", requestId),
                404,
            );
        }
        if (message.includes("timeout") || message.includes("aborted")) {
            return c.json(
                createErrorResponse("FETCH_TIMEOUT", "Research timed out before completing", requestId),
                502,
            );
        }
        return c.json(createErrorResponse("RESEARCH_FAILED", message, requestId), 502);
    }
}
