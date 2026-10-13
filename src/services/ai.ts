/**
 * AI Service - Claude API Integration
 * Provides AI-powered capabilities for summarization, extraction, and comparison
 *
 * Requirements: 2.4, 3.1, 6.3
 * - Use Claude for summarization in research
 * - Use Claude for intelligent extraction
 * - Use Claude for comparison analysis
 */

import { AI_MODEL, PAID_UPSTREAMS } from "../config";

export interface AIServiceConfig {
  apiKey: string;
  maxTokens?: number;
}

const DEFAULT_MAX_TOKENS = 4000;

/**
 * Strip markdown code fences from Claude's response text.
 * Claude sometimes wraps JSON output in ```json ... ``` blocks despite
 * being instructed to respond with raw JSON only.
 */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  // Match ```json ... ``` or ``` ... ```
  const fenceMatch = /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/i.exec(trimmed);
  const captured = fenceMatch?.[1];
  return captured !== undefined ? captured.trim() : trimmed;
}

/**
 * Call Claude (AI_MODEL) with a prompt and return its text.
 *
 * Thinking is turned off: every caller has a hard output cap and a cost
 * ceiling priced on the visible answer, and Haiku 5.5's adaptive thinking would
 * spend that budget before the answer (thinking counts toward max_tokens).
 * Haiku 5.5 accepts `thinking: {type: "disabled"}` at its default effort.
 */
export async function callClaude(
  config: AIServiceConfig,
  prompt: string,
  systemPrompt?: string
): Promise<string> {
  const response = await fetch(PAID_UPSTREAMS.anthropicMessages, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
      thinking: { type: "disabled" },
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    }),
    // Anthropic can take up to ~60s for long extractions; cap at 90s so a
    // hung TCP connection cannot tie up the Worker isolate indefinitely.
    signal: AbortSignal.timeout(90000),
  });

  if (!response.ok) {
    const status = response.status;
    if (status === 503 || status === 529) {
      throw new AIUnavailableError("Claude API is temporarily unavailable");
    }
    if (status === 401) {
      throw new AIUnavailableError("Invalid API key");
    }
    throw new AIUnavailableError(`Claude API error: ${String(status)}`);
  }

  // The reply is a list of content blocks; the answer is the text block.
  interface ClaudeResponse { content: { type: string; text?: string }[] }
  const result: ClaudeResponse = await response.json();
  return stripCodeFences(result.content.find((block) => block.type === "text")?.text ?? "");
}

/**
 * Custom error for AI service unavailability
 */
export class AIUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIUnavailableError";
  }
}


/**
 * Check if AI service is available
 */
export function isAIAvailable(apiKey: string | undefined): apiKey is string {
  return apiKey !== undefined && apiKey.length > 0;
}

/**
 * Handle AI errors and return appropriate error response
 * Requirement 3.6: Handle AI unavailability gracefully
 */
export function handleAIError(error: unknown): {
  code: string;
  message: string;
  status: number;
  retryable: boolean;
} {
  if (error instanceof AIUnavailableError) {
    return {
      code: "AI_UNAVAILABLE",
      message: error.message,
      status: 503,
      retryable: true,
    };
  }

  if (error instanceof Error) {
    if (
      error.message.includes("timeout") ||
      error.message.includes("network")
    ) {
      return {
        code: "AI_UNAVAILABLE",
        message: "AI service temporarily unavailable",
        status: 503,
        retryable: true,
      };
    }

    if (
      error.message.includes("extract") ||
      error.message.includes("parse")
    ) {
      return {
        code: "EXTRACTION_FAILED",
        message: error.message,
        status: 500,
        retryable: true,
      };
    }

    return {
      code: "INTERNAL_ERROR",
      message: error.message,
      status: 500,
      retryable: false,
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : "Unknown error",
    status: 500,
    retryable: false,
  };
}
