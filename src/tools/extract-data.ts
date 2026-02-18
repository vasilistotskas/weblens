import type { Context } from "hono";
import { z } from "zod/v4";
import { createErrorResponse } from "../middleware/errorHandler";
import { hashContent, signContext } from "../services/crypto";
import type { Env, ExtractRequest, ExtractResponse } from "../types";
import { htmlToMarkdown } from "../utils/parser";
import { generateRequestId } from "../utils/requestId";

const extractSchema = z.object({
  url: z.url(),
  schema: z.record(z.string(), z.unknown()),
  instructions: z.string().optional(),
});

export async function extractData(c: Context<{ Bindings: Env }>) {
  const requestId = generateRequestId();

  try {
    const body = await c.req.json<ExtractRequest>();
    const parsed = extractSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ ...createErrorResponse("INVALID_REQUEST", "Invalid request parameters", requestId), details: parsed.error.issues }, 400);
    }

    const { url, schema, instructions } = parsed.data;

    const response = await fetch(url, {
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

    const html = await response.text();
    const content = htmlToMarkdown(html);

    const anthropicKey = c.env.ANTHROPIC_API_KEY;

    if (!anthropicKey) {
      const data = basicExtraction(html, schema);
      return c.json({
        url,
        data,
        extractedAt: new Date().toISOString(),
        requestId,
        note: "Basic extraction (no AI). Set ANTHROPIC_API_KEY for intelligent extraction.",
      });
    }

    const data = await aiExtraction(content, schema, instructions, anthropicKey);

    const result: ExtractResponse = {
      url,
      data,
      extractedAt: new Date().toISOString(),
      requestId,
    };

    // Generate ACV Proof if possible
    if (c.env.SIGNING_PRIVATE_KEY || c.env.CDP_API_KEY_SECRET) {
      try {
        const timestamp = result.extractedAt;
        const hash = await hashContent(html);
        const { signature, publicKey } = await signContext(url, hash, timestamp, c.env);

        result.proof = {
          hash,
          timestamp,
          signature,
          publicKey
        };
      } catch (err) {
        console.warn(`Failed to generate ACV proof: ${String(err)}`);
      }
    }

    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json(createErrorResponse("INTERNAL_ERROR", message, requestId), 500);
  }
}

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

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`AI extraction failed: ${String(response.status)}`);
  }

  interface ClaudeResponse { content: { text?: string }[] }
  const result: ClaudeResponse = await response.json();
  const firstContent = result.content[0];
  const text = firstContent.text ?? "{}";

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

function basicExtraction(
  html: string,
  schema: Record<string, unknown>
): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  for (const key of Object.keys(schema)) {
    const lowerKey = key.toLowerCase();

    if (lowerKey.includes("price")) {
      const priceMatch = /\$[\d,]+\.?\d*/.exec(html);
      data[key] = priceMatch?.[0] ?? null;
    } else if (lowerKey.includes("email")) {
      const emailMatch = /[\w.-]+@[\w.-]+\.\w+/.exec(html);
      data[key] = emailMatch?.[0] ?? null;
    } else if (lowerKey.includes("phone")) {
      const phoneMatch = /[\d-()+ ]{10,}/.exec(html);
      data[key] = phoneMatch?.[0]?.trim() ?? null;
    } else if (lowerKey.includes("title")) {
      const titleMatch = /<title>([^<]+)<\/title>/i.exec(html);
      data[key] = titleMatch?.[1] ?? null;
    } else {
      data[key] = null;
    }
  }

  return data;
}
