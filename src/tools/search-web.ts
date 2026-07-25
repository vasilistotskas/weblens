import type { Context } from "hono";
import type { z } from "zod/v4";
import { createErrorResponse } from "../middleware/errorHandler";
import type { SearchRequestSchema } from "../schemas";
import { searchWeb } from "../services/search";
import type { Env, SearchResponse } from "../types";
import { fetchBasicPage } from "./fetch-basic";

export async function searchWebHandler(c: Context<{ Bindings: Env }>) {
  const requestId = c.get("requestId");

  try {
    const { query, limit, includeContent, contentResults, contentChars } =
      c.get("validatedBody") as z.infer<typeof SearchRequestSchema>;

    const results = await searchWeb({
      query,
      limit,
      serpApiKey: c.env.SERP_API_KEY,
    });

    // Search-with-content: fetch the top-N result pages in parallel and
    // attach their markdown. Failures degrade to the plain SERP entry.
    let enriched = results as (typeof results[number] & { content?: string; contentTruncated?: boolean })[];
    if (includeContent && results.length > 0) {
      const toFetch = results.slice(0, contentResults);
      const fetched = await Promise.allSettled(
        toFetch.map((r) => fetchBasicPage(r.url, 10000)),
      );
      enriched = results.map((r, i) => {
        const outcome = i < fetched.length ? fetched[i] : undefined;
        if (outcome?.status === "fulfilled") {
          const truncated = outcome.value.content.length > contentChars;
          return {
            ...r,
            content: truncated ? outcome.value.content.slice(0, contentChars) : outcome.value.content,
            contentTruncated: truncated,
          };
        }
        return r;
      });
    }

    const result: SearchResponse = {
      query,
      results: enriched,
      searchedAt: new Date().toISOString(),
      requestId,
    };

    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    if (message.includes("bot detection") || message.includes("challenge")) {
      return c.json(createErrorResponse("SERVICE_UNAVAILABLE", "Search provider temporarily unavailable", requestId), 502);
    }

    return c.json(createErrorResponse("INTERNAL_ERROR", message, requestId), 500);
  }
}
