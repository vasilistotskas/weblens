/**
 * Research Endpoint Handler
 * One-stop research: search + fetch + AI summarize
 *
 * Requirements: 2.1, 2.5
 * - POST /research with query string
 * - Return sources, content, and AI summary
 */

import type { Context } from "hono";
import { z } from "zod/v4";
import type { Env, ResearchRequest, ResearchResponse } from "../types";
import { generateRequestId } from "../utils/requestId";
import { research } from "../services/research";
import { isAIAvailable, handleAIError, AIUnavailableError } from "../services/ai";

const researchSchema = z.object({
  query: z.string().min(1).max(500),
  resultCount: z.number().min(1).max(10).default(5),
  includeRawContent: z.boolean().default(false),
});

/**
 * Research endpoint handler
 * POST /research
 */
export async function researchHandler(c: Context<{ Bindings: Env }>) {
  const requestId = generateRequestId();

  try {
    const body = await c.req.json<ResearchRequest>();
    const parsed = researchSchema.safeParse(body);

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

    const { query, resultCount, includeRawContent } = parsed.data;

    // Check if AI is available
    if (!isAIAvailable(c.env.ANTHROPIC_API_KEY)) {
      return c.json(
        {
          error: "AI_UNAVAILABLE",
          code: "AI_UNAVAILABLE",
          message:
            "AI service not configured. Set ANTHROPIC_API_KEY for research.",
          requestId,
        },
        503
      );
    }

    // Perform research
    const result = await research({
      query,
      resultCount,
      includeRawContent,
      aiConfig: {
        apiKey: c.env.ANTHROPIC_API_KEY!,
      },
    });

    const response: ResearchResponse = {
      query: result.query,
      sources: result.sources,
      summary: result.summary,
      keyFindings: result.keyFindings,
      researchedAt: new Date().toISOString(),
      requestId,
    };

    return c.json(response);
  } catch (error) {
    // Handle AI-specific errors
    if (error instanceof AIUnavailableError) {
      const aiError = handleAIError(error);
      return c.json(
        {
          error: aiError.code,
          code: aiError.code,
          message: aiError.message,
          requestId,
          retryAfter: aiError.retryable ? 30 : undefined,
        },
        aiError.status as 400 | 500 | 503
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";

    // Check for research-specific failures
    if (message.includes("Search failed")) {
      return c.json(
        {
          error: "RESEARCH_FAILED",
          code: "RESEARCH_FAILED",
          message: "Failed to search for research topic",
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
