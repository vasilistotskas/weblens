/**
 * Smart Extraction Endpoint Handler
 * AI-powered data extraction using natural language queries
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.6
 * - POST /extract/smart with URL and natural language query
 * - Use AI for intelligent extraction
 * - Return structured data with confidence scores
 */

import type { Context } from "hono";
import { z } from "zod/v4";
import {
  smartExtract,
  isAIAvailable,
  handleAIError,
  AIUnavailableError,
} from "../services/ai";
import { validateURL } from "../services/validator";
import type { Env, SmartExtractRequest, SmartExtractResponse } from "../types";
import { generateRequestId } from "../utils/requestId";
import { fetchBasicPage } from "./fetch-basic";

const smartExtractSchema = z.object({
  url: z.string(),
  query: z.string().min(1).max(500),
  format: z.enum(["json", "text"]).default("json"),
});

/**
 * Smart Extract endpoint handler
 * POST /extract/smart
 */
export async function smartExtractHandler(c: Context<{ Bindings: Env }>) {
  const requestId = generateRequestId();

  try {
    const body = await c.req.json<SmartExtractRequest>();
    const parsed = smartExtractSchema.safeParse(body);

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

    const { url, query, format } = parsed.data;

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

    // Check if AI is available
    if (!isAIAvailable(c.env.ANTHROPIC_API_KEY)) {
      return c.json(
        {
          error: "AI_UNAVAILABLE",
          code: "AI_UNAVAILABLE",
          message:
            "AI service not configured. Set ANTHROPIC_API_KEY for smart extraction.",
          requestId,
        },
        503
      );
    }

    // Fetch the page content
    const fetchResult = await fetchBasicPage(
      urlValidation.normalized ?? url,
      15000
    );

    // Perform AI extraction
    const extractResult = await smartExtract(
      { apiKey: c.env.ANTHROPIC_API_KEY },
      {
        content: fetchResult.content,
        query,
        format,
      }
    );

    // Handle empty results gracefully (Requirement 3.6)
    if (extractResult.data.length === 0) {
      const response: SmartExtractResponse = {
        url,
        query,
        data: [],
        explanation:
          extractResult.explanation ||
          "No matching data found for the given query.",
        extractedAt: new Date().toISOString(),
        requestId,
      };
      return c.json(response);
    }

    const response: SmartExtractResponse = {
      url,
      query,
      data: extractResult.data,
      explanation: extractResult.explanation,
      extractedAt: new Date().toISOString(),
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

    // Check for fetch timeout
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

    // Check for extraction failures
    if (message.includes("extract") || message.includes("parse")) {
      return c.json(
        {
          error: "EXTRACTION_FAILED",
          code: "EXTRACTION_FAILED",
          message: "AI extraction failed: " + message,
          requestId,
        },
        500
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
