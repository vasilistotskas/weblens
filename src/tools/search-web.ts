import type { Context } from "hono";
import type { z } from "zod/v4";
import { createErrorResponse } from "../middleware/errorHandler";
import type { SearchRequestSchema } from "../schemas";
import { searchWeb } from "../services/search";
import type { Env, SearchResponse } from "../types";

export async function searchWebHandler(c: Context<{ Bindings: Env }>) {
  const requestId = c.get("requestId");

  try {
    const { query, limit } = c.get("validatedBody") as z.infer<typeof SearchRequestSchema>;

    const results = await searchWeb({
      query,
      limit,
      serpApiKey: c.env.SERP_API_KEY,
    });

    const result: SearchResponse = {
      query,
      results,
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
