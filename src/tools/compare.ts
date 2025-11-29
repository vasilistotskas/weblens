/**
 * Compare Endpoint Handler
 * Compares multiple URLs with AI-generated analysis
 *
 * Requirements: 6.1, 6.2, 6.3, 6.5, 6.6
 * - POST /compare with 2-3 URLs
 * - Fetch all URLs and generate AI comparison
 * - Identify similarities and differences
 * - Return fetched content and AI-generated comparison
 */

import type { Context } from "hono";
import { z } from "zod/v4";
import { compare as aiCompare, isAIAvailable, handleAIError, AIUnavailableError } from "../services/ai";
import type { Env, CompareRequest, CompareResponse, CompareSource } from "../types";
import { generateRequestId } from "../utils/requestId";
import { fetchBasicPage } from "./fetch-basic";

const compareSchema = z.object({
  urls: z.array(z.url()).min(2).max(3),
  focus: z.string().max(500).optional(),
});

/**
 * Compare endpoint handler
 * POST /compare
 */
export async function compareHandler(c: Context<{ Bindings: Env }>) {
  const requestId = generateRequestId();

  try {
    const body = await c.req.json<CompareRequest>();
    const parsed = compareSchema.safeParse(body);

    if (!parsed.success) {
      // Check for specific bounds errors
      const urlsIssue = parsed.error.issues.find(
        (issue) => issue.path[0] === "urls"
      );
      
      if (urlsIssue?.code === "too_small") {
        return c.json(
          {
            error: "COMPARE_TOO_SMALL",
            code: "COMPARE_TOO_SMALL",
            message: "Minimum 2 URLs required for comparison",
            requestId,
          },
          400
        );
      }

      if (urlsIssue?.code === "too_big") {
        return c.json(
          {
            error: "COMPARE_TOO_LARGE",
            code: "COMPARE_TOO_LARGE",
            message: "Maximum 3 URLs allowed for comparison",
            requestId,
          },
          400
        );
      }

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

    const { urls, focus } = parsed.data;

    // Check if AI is available
    if (!isAIAvailable(c.env.ANTHROPIC_API_KEY)) {
      return c.json(
        {
          error: "AI_UNAVAILABLE",
          code: "AI_UNAVAILABLE",
          message: "AI service not configured. Set ANTHROPIC_API_KEY for comparison.",
          requestId,
        },
        503
      );
    }

    // Fetch all URLs in parallel
    const fetchResults = await Promise.all(
      urls.map(async (url) => {
        try {
          const result = await fetchBasicPage(url, 10000);
          return {
            url,
            title: result.title,
            content: result.content,
            success: true,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          return {
            url,
            title: "",
            content: "",
            success: false,
            error: message,
          };
        }
      })
    );

    // Check if we have at least 2 successful fetches
    const successfulFetches = fetchResults.filter((r) => r.success);
    if (successfulFetches.length < 2) {
      return c.json(
        {
          error: "FETCH_FAILED",
          code: "FETCH_FAILED",
          message: "Failed to fetch enough URLs for comparison. At least 2 URLs must be fetchable.",
          requestId,
          details: fetchResults
            .filter((r) => !r.success)
            .map((r) => ({ url: r.url, error: r.error })),
        },
        502
      );
    }

    // Prepare sources for AI comparison
    const sources: CompareSource[] = fetchResults
      .filter((r) => r.success)
      .map((r) => ({
        url: r.url,
        title: r.title,
        content: r.content,
      }));

    // Generate AI comparison
    const comparisonResult = await aiCompare(
      { apiKey: c.env.ANTHROPIC_API_KEY },
      { sources, focus }
    );

    const response: CompareResponse = {
      sources,
      comparison: {
        similarities: comparisonResult.similarities,
        differences: comparisonResult.differences,
        summary: comparisonResult.summary,
      },
      comparedAt: new Date().toISOString(),
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
