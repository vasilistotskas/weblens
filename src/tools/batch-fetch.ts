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
import { z } from "zod/v4";
import { PRICING, getBatchFetchPrice } from "../config";
import { batchFetch } from "../services/batch";
import { validateURL } from "../services/validator";
import type { Env, BatchFetchRequest, BatchFetchResponse } from "../types";
import { generateRequestId } from "../utils/requestId";

const batchFetchSchema = z.object({
  urls: z
    .array(z.string())
    .min(PRICING.batchFetch.minUrls)
    .max(PRICING.batchFetch.maxUrls),
  timeout: z.number().min(1000).max(30000).default(10000),
  tier: z.enum(["basic", "pro"]).default("basic"),
});

/**
 * Batch Fetch endpoint handler
 * POST /batch/fetch
 */
export async function batchFetchHandler(c: Context<{ Bindings: Env }>) {
  const requestId = generateRequestId();

  try {
    const body = await c.req.json<BatchFetchRequest>();
    const parsed = batchFetchSchema.safeParse(body);

    if (!parsed.success) {
      // Check for specific bound violations
      const urlsIssue = parsed.error.issues.find((i) => i.path[0] === "urls");
      if (urlsIssue) {
        const urlsLength = body.urls.length;
        if (
          urlsIssue.code === "too_small" ||
          urlsLength < PRICING.batchFetch.minUrls
        ) {
          return c.json(
            {
              error: "BATCH_TOO_SMALL",
              code: "BATCH_TOO_SMALL",
              message: `Minimum ${String(PRICING.batchFetch.minUrls)} URLs required`,
              requestId,
            },
            400
          );
        }
        if (
          urlsIssue.code === "too_big" ||
          urlsLength > PRICING.batchFetch.maxUrls
        ) {
          return c.json(
            {
              error: "BATCH_TOO_LARGE",
              code: "BATCH_TOO_LARGE",
              message: `Maximum ${String(PRICING.batchFetch.maxUrls)} URLs allowed`,
              requestId,
            },
            400
          );
        }
      }

      return c.json(
        {
          error: "INVALID_REQUEST",
          code: "INVALID_REQUEST",
          message: "Invalid request parameters",
          requestId,
          details: parsed.error.issues,
        },
        400
      );
    }

    const { urls, timeout } = parsed.data;

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
