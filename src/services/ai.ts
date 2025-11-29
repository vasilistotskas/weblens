/**
 * AI Service - Claude API Integration
 * Provides AI-powered capabilities for summarization, extraction, and comparison
 *
 * Requirements: 2.4, 3.1, 6.3
 * - Use Claude for summarization in research
 * - Use Claude for intelligent extraction
 * - Use Claude for comparison analysis
 */

export interface AIServiceConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

export interface SummarizeOptions {
  content: string;
  query?: string;
  maxLength?: number;
}

export interface SummarizeResult {
  summary: string;
  keyFindings: string[];
}

export interface ExtractOptions {
  content: string;
  query: string;
  format?: "json" | "text";
}

export interface ExtractedItem {
  value: unknown;
  context?: string;
  confidence: number;
}

export interface ExtractResult {
  data: ExtractedItem[];
  explanation: string;
}

export interface CompareOptions {
  sources: { url: string; title: string; content: string }[];
  focus?: string;
}

export interface CompareResult {
  similarities: string[];
  differences: string[];
  summary: string;
}

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MAX_TOKENS = 4000;

interface ClaudeApiResponse {
  content: { text?: string }[];
}

/**
 * Call Claude API with a prompt
 */
async function callClaude(
  config: AIServiceConfig,
  prompt: string,
  systemPrompt?: string
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
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

  const result = (await response.json());
  const firstContent = result.content[0];
  return firstContent?.text ?? "";
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
 * Extract data using natural language query
 * Used by: /extract/smart endpoint
 */
export async function smartExtract(
  config: AIServiceConfig,
  options: ExtractOptions
): Promise<ExtractResult> {
  const { content, query, format = "json" } = options;

  const systemPrompt = `You are a data extraction assistant. Extract information based on natural language queries.
Always respond with valid JSON in this exact format:
{
  "data": [
    {"value": "extracted value", "context": "surrounding context", "confidence": 0.95}
  ],
  "explanation": "Brief explanation of what was extracted and how"
}
Confidence should be 0-1 based on how certain you are about the extraction.`;

  const prompt = `Extract the following from the content: "${query}"

Content:
${content.slice(0, 10000)}

${format === "text" ? "Return values as strings." : "Return structured data where appropriate."}

Respond ONLY with valid JSON.`;

  const response = await callClaude(config, prompt, systemPrompt);

  try {
    const parsed = JSON.parse(response) as Partial<ExtractResult>;
    return {
      data: parsed.data ?? [],
      explanation: parsed.explanation ?? "",
    };
  } catch {
    return {
      data: [],
      explanation: "Failed to parse extraction results",
    };
  }
}

/**
 * Compare multiple sources and identify similarities/differences
 * Used by: /compare endpoint
 */
export async function compare(
  config: AIServiceConfig,
  options: CompareOptions
): Promise<CompareResult> {
  const { sources, focus } = options;

  const systemPrompt = `You are a comparison analyst. Compare multiple sources and identify key similarities and differences.
Always respond with valid JSON in this exact format:
{
  "similarities": ["Similarity 1", "Similarity 2"],
  "differences": ["Difference 1", "Difference 2"],
  "summary": "A concise summary of the comparison"
}`;

  const sourcesText = sources
    .map(
      (s, i) => `
--- Source ${String(i + 1)}: ${s.title} (${s.url}) ---
${s.content.slice(0, 4000)}
`
    )
    .join("\n");

  const prompt = `Compare the following ${String(sources.length)} sources${focus ? ` focusing on: "${focus}"` : ""}.

${sourcesText}

Identify key similarities and differences. Provide a summary of the comparison.

Respond ONLY with valid JSON.`;

  const response = await callClaude(config, prompt, systemPrompt);

  try {
    const parsed = JSON.parse(response) as Partial<CompareResult>;
    return {
      similarities: parsed.similarities ?? [],
      differences: parsed.differences ?? [],
      summary: parsed.summary ?? "",
    };
  } catch {
    return {
      similarities: [],
      differences: [],
      summary: "Failed to parse comparison results",
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
