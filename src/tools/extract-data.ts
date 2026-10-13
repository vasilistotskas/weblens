import type { Context } from "hono";
import type { z } from "zod/v4";
import { createErrorResponse } from "../middleware/errorHandler";
import type { ExtractRequestSchema } from "../schemas";
import { AIUnavailableError, callClaude, isAIAvailable } from "../services/ai";
import { validateURL } from "../services/validator";
import type { AppEnv, ExtractResponse } from "../types";
import { htmlToMarkdown } from "../utils/parser";
import { readDocument, safeFetch, UnsupportedContentError } from "../utils/safe-fetch";

const EXTRACTION_MAX_TOKENS = 2000;

export async function extractData(c: Context<AppEnv>) {
  const requestId = c.get("requestId");

  try {
    const { url, schema, instructions } = c.get("validatedBody") as z.infer<typeof ExtractRequestSchema>;

    // Extraction is an AI product: without a model the paid call fails (and is
    // refunded) instead of returning a regex guess at full price.
    const anthropicKey = c.env.ANTHROPIC_API_KEY;
    if (!isAIAvailable(anthropicKey)) {
      return c.json(createErrorResponse("AI_UNAVAILABLE", "AI service not configured", requestId), 503);
    }

    const urlValidation = validateURL(url);
    if (!urlValidation.valid) {
      return c.json(createErrorResponse("INVALID_URL", urlValidation.error ?? "Invalid URL", requestId), 400);
    }

    const response = await safeFetch(urlValidation.normalized ?? url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return c.json(createErrorResponse("RENDER_FAILED", `Failed to fetch: ${String(response.status)}`, requestId), 502);
    }

    const html = await readDocument(response);
    const content = htmlToMarkdown(html);

    const data = await aiExtraction(content, schema, instructions, anthropicKey);

    const result: ExtractResponse = {
      url,
      data,
      extractedAt: new Date().toISOString(),
      requestId,
    };

    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (error instanceof UnsupportedContentError) {
      return c.json(createErrorResponse("UNSUPPORTED_CONTENT", message, requestId), 422);
    }
    // Either way the paid call fails, so the payment is cancelled (or the
    // credit refunded) instead of charging for a degraded answer.
    if (error instanceof AIUnavailableError) {
      return c.json(createErrorResponse("AI_UNAVAILABLE", message, requestId), 503);
    }
    if (error instanceof ExtractionFailedError) {
      return c.json(createErrorResponse("EXTRACTION_FAILED", message, requestId), 502);
    }
    return c.json(createErrorResponse("INTERNAL_ERROR", message, requestId), 500);
  }
}

/** Thrown when the model's answer is not the JSON object the schema asked for. */
class ExtractionFailedError extends Error {}

async function aiExtraction(
  content: string,
  schema: Record<string, unknown>,
  instructions: string | undefined,
  apiKey: string
): Promise<Record<string, unknown>> {
  const prompt = `Extract data from the following content according to this JSON schema:

Schema:
${JSON.stringify(schema, null, 2)}

${instructions ? `Additional instructions: ${instructions}` : ""}

Content:
${content.slice(0, 8000)}

Respond ONLY with valid JSON matching the schema. No explanations.`;

  const text = await callClaude({ apiKey, maxTokens: EXTRACTION_MAX_TOKENS }, prompt);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ExtractionFailedError("The model did not return JSON for this schema");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ExtractionFailedError("The model did not return a JSON object for this schema");
  }
  return parsed as Record<string, unknown>;
}
