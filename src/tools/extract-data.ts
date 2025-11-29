import type { Context } from "hono";
import { z } from "zod/v4";
import type { Env, ExtractRequest, ExtractResponse } from "../types";
import { htmlToMarkdown } from "../utils/parser";
import { generateRequestId } from "../utils/requestId";

const extractSchema = z.object({
  url: z.url(),
  schema: z.record(z.string(), z.unknown()),
  instructions: z.string().optional(),
});

export async function extractData(c: Context<{ Bindings: Env }>) {
  try {
    const body = await c.req.json<ExtractRequest>();
    const parsed = extractSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
    }

    const { url, schema, instructions } = parsed.data;

    // Fetch the page
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return c.json({ error: `Failed to fetch: ${response.status}` }, 502);
    }

    const html = await response.text();
    const content = htmlToMarkdown(html);

    // Use Claude for intelligent extraction
    const anthropicKey = c.env.ANTHROPIC_API_KEY;

    if (!anthropicKey) {
      // Fallback: basic regex extraction
      const data = basicExtraction(html, schema);
      return c.json({
        url,
        data,
        extractedAt: new Date().toISOString(),
        note: "Basic extraction (no AI). Set ANTHROPIC_API_KEY for intelligent extraction.",
      });
    }

    // AI-powered extraction
    const data = await aiExtraction(content, schema, instructions, anthropicKey);

    const result: ExtractResponse = {
      url,
      data,
      extractedAt: new Date().toISOString(),
      requestId: generateRequestId(),
    };

    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: message }, 500);
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
    throw new Error(`AI extraction failed: ${response.status}`);
  }

  const result = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  const text = result.content[0]?.text || "{}";

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function basicExtraction(
  html: string,
  schema: Record<string, unknown>
): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  // Extract common patterns based on schema keys
  for (const key of Object.keys(schema)) {
    const lowerKey = key.toLowerCase();

    if (lowerKey.includes("price")) {
      const priceMatch = html.match(/\$[\d,]+\.?\d*/);
      data[key] = priceMatch?.[0] || null;
    } else if (lowerKey.includes("email")) {
      const emailMatch = html.match(/[\w.-]+@[\w.-]+\.\w+/);
      data[key] = emailMatch?.[0] || null;
    } else if (lowerKey.includes("phone")) {
      const phoneMatch = html.match(/[\d-()+ ]{10,}/);
      data[key] = phoneMatch?.[0]?.trim() || null;
    } else if (lowerKey.includes("title")) {
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      data[key] = titleMatch?.[1] || null;
    } else {
      data[key] = null;
    }
  }

  return data;
}
