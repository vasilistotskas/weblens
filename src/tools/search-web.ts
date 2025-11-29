import type { Context } from "hono";
import { z } from "zod/v4";
import type { Env, SearchRequest, SearchResponse, SearchResult } from "../types";
import { generateRequestId } from "../utils/requestId";

const searchSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().min(1).max(20).default(10),
});

export async function searchWeb(c: Context<{ Bindings: Env }>) {
  try {
    const body = await c.req.json<SearchRequest>();
    const parsed = searchSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
    }

    const { query, limit } = parsed.data;

    // Use DuckDuckGo HTML search (free, no API key needed)
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
    });

    if (!response.ok) {
      return c.json({ error: "Search failed" }, 502);
    }

    const html = await response.text();
    const results = parseDuckDuckGoResults(html, limit);

    const result: SearchResponse = {
      query,
      results,
      searchedAt: new Date().toISOString(),
      requestId: generateRequestId(),
    };

    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: message }, 500);
  }
}

function parseDuckDuckGoResults(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Simple regex-based parsing for DuckDuckGo HTML results
  const resultRegex =
    /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]*)<\/a>/gi;

  let match;
  let position = 1;

  while ((match = resultRegex.exec(html)) !== null && results.length < limit) {
    const [, url, title, snippet] = match;

    if (url && title) {
      results.push({
        title: decodeHtmlEntities(title.trim()),
        url: decodeURIComponent(url),
        snippet: decodeHtmlEntities(snippet?.trim() || ""),
        position: position++,
      });
    }
  }

  // Fallback: try alternative parsing if regex didn't work
  if (results.length === 0) {
    const linkRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*>([^<]+)<\/a>/gi;
    const urlRegex = /href="\/\/duckduckgo\.com\/l\/\?uddg=([^&"]+)/gi;

    let linkMatch;
    while ((linkMatch = linkRegex.exec(html)) !== null && results.length < limit) {
      results.push({
        title: decodeHtmlEntities(linkMatch[1].trim()),
        url: "",
        snippet: "",
        position: position++,
      });
    }
  }

  return results;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
