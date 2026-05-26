/**
 * Batch Fetch Endpoint Handler
 * Fetches multiple URLs in a single request
 *
 * Requirements: 1.1, 1.2, 1.3, 1.6
 * - POST /batch/fetch with array of 2-20 URLs
 * - Return results for each URL
 * - Validate URL count bounds
 */

import type { Context } from "hono";
import type { z } from "zod/v4";
import type { BatchFetchRequestSchema } from "../schemas";
import { batchFetch } from "../services/batch";
import { getBatchFetchPrice } from "../services/pricing";
import { validateURL } from "../services/validator";
import type { Env, BatchFetchResponse } from "../types";

/**
 * Batch Fetch endpoint handler
 * POST /batch/fetch
 */
export async function batchFetchHandler(c: Context<{ Bindings: Env }>) {
  const requestId = c.get("requestId");

  try {
    const { urls, timeout } = c.get("validatedBody") as z.infer<typeof BatchFetchRequestSchema>;

    // Validate all URLs
    const validatedUrls: string[] = [];
    for (const url of urls) {
      const validation = validateURL(url);
      if (!validation.valid) {
        return c.json(
          {
            error: "INVALID_URL",
            code: "INVALID_URL",
            message: `Invalid URL: ${url} - ${validation.error ?? "unknown error"}`,
            requestId,
          },
          400
        );
      }
      validatedUrls.push(validation.normalized ?? url);
    }

    // Fetch all URLs in parallel
    const results = await batchFetch(validatedUrls, timeout);

    // Calculate summary
    const successful = results.filter((r) => r.status === "success").length;
    const failed = results.filter((r) => r.status === "error").length;

    const response: BatchFetchResponse = {
      results,
      summary: {
        total: results.length,
        successful,
        failed,
      },
      totalPrice: getBatchFetchPrice(urls.length),
      requestId,
    };

    return c.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    return c.json(
      {
        error: "INTERNAL_ERROR",
        code: "INTERNAL_ERROR",
        message,
        requestId,
      },
      500
    );
  }
}
