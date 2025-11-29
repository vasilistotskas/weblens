import type { Context } from "hono";
import { z } from "zod/v4";
import type { Env, FetchRequest, FetchResponse } from "../types";
import { htmlToMarkdown, extractMetadata } from "../utils/parser";
import { generateRequestId } from "../utils/requestId";

const fetchSchema = z.object({
  url: z.url(),
  waitFor: z.string().optional(),
  timeout: z.number().min(1000).max(30000).default(10000),
});

export async function fetchPage(c: Context<{ Bindings: Env }>) {
  try {
    const body = await c.req.json<FetchRequest>();
    const parsed = fetchSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
    }

    const { url, timeout } = parsed.data;

    // Fetch the page
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      return c.json({ error: `Failed to fetch: ${response.status} ${response.statusText}` }, 502);
    }

    const html = await response.text();
    const content = htmlToMarkdown(html);
    const metadata = extractMetadata(html);

    const result: FetchResponse = {
      url,
      title: metadata.title || "",
      content,
      metadata: {
        description: metadata.description,
        author: metadata.author,
        publishedAt: metadata.publishedAt,
      },
      tier: "basic",
      fetchedAt: new Date().toISOString(),
      requestId: generateRequestId(),
    };

    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: message }, 500);
  }
}
