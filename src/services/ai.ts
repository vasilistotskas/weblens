/**
 * AI Service - Claude API Integration
 * Provides AI-powered capabilities for summarization, extraction, and comparison
 *
 * Requirements: 2.4, 3.1, 6.3
 * - Use Claude for summarization in research
 * - Use Claude for intelligent extraction
 * - Use Claude for comparison analysis
 */

import { PAID_UPSTREAMS } from "../config";

export interface AIServiceConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

interface SummarizeOptions {
  content: string;
  query?: string;
  maxLength?: number;
}

interface SummarizeResult {
  summary: string;
  keyFindings: string[];
}

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
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
 * Call Claude API with a prompt
 * Exported as callClaudePublic for use by intel service workflows
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
      model: config.model ?? DEFAULT_MODEL,
      max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
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

  interface ClaudeResponse { content: { text?: string }[] }
  const result: ClaudeResponse = await response.json();
  return stripCodeFences(result.content[0]?.text ?? "");
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
 * Summarize content with optional query focus
 * Used by: /research endpoint
 */
export async function summarize(
  config: AIServiceConfig,
  options: SummarizeOptions
): Promise<SummarizeResult> {
  const { content, query, maxLength = 500 } = options;

  const systemPrompt = `You are a research assistant that summarizes web content concisely and accurately.
Always respond with valid JSON in this exact format:
{
  "summary": "A concise summary of the content",
  "keyFindings": ["Finding 1", "Finding 2", "Finding 3"]
}`;

  const prompt = `Summarize the following content${query ? ` focusing on: "${query}"` : ""}.
Keep the summary under ${String(maxLength)} words. Extract 3-5 key findings.

Content:
${content.slice(0, 12000)}

Respond ONLY with valid JSON.`;

  const response = await callClaude(config, prompt, systemPrompt);

  try {
    const parsed = JSON.parse(response) as Partial<SummarizeResult>;
    return {
      summary: parsed.summary ?? "",
      keyFindings: parsed.keyFindings ?? [],
    };
  } catch {
    return {
      summary: response.slice(0, maxLength * 6),
      keyFindings: [],
    };
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
