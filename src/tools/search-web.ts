import type { Context } from "hono";
import { z } from "zod/v4";
import { createErrorResponse } from "../middleware/errorHandler";
import { searchWeb } from "../services/search";
import type { Env, SearchRequest, SearchResponse } from "../types";
import { generateRequestId } from "../utils/requestId";

const searchSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().min(1).max(20).default(10),
});

export async function searchWebHandler(c: Context<{ Bindings: Env }>) {
  const requestId = generateRequestId();

  try {
    const body = await c.req.json<SearchRequest>();
    const parsed = searchSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ ...createErrorResponse("INVALID_REQUEST", "Invalid request parameters", requestId), details: parsed.error.issues }, 400);
    }

    const { query, limit } = parsed.data;

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
