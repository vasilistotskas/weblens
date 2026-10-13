/**
 * Fetch Basic Endpoint Handler
 * Fetches webpage without JavaScript rendering (basic tier)
 * 
 * Requirements: 2.1, 2.5
 * - Price: PRICING.fetch.basic
 * - No JS rendering
 * - Includes tier metadata in response
 */

import type { Context } from "hono";
import type { z } from "zod/v4";
import { classifyFetchError, createErrorResponse } from "../middleware/errorHandler";
import type { FetchRequestSchema } from "../schemas";
import { validateURL } from "../services/validator";
import type { Env, FetchResponse } from "../types";
import { htmlToMarkdown, extractMetadata } from "../utils/parser";
import { assertTargetOk, readDocument, safeFetch } from "../utils/safe-fetch";

export interface FetchBasicResult {
  url: string;
  title: string;
  content: string;
  metadata: {
    description?: string;
    author?: string;
    publishedAt?: string;
  };
  tier: "basic";
  fetchedAt: string;
}

/**
 * Fetch a webpage without JavaScript rendering
 * 
 * @param url - The URL to fetch
 * @param timeout - Request timeout in milliseconds
 * @returns The fetched page content and metadata
 */
export async function fetchBasicPage(
  url: string,
  timeout: number = 10000,
): Promise<FetchBasicResult> {
  const response = await safeFetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
    signal: AbortSignal.timeout(timeout),
  });

  await assertTargetOk(response);

  const html = await readDocument(response);
  const content = htmlToMarkdown(html);
  const metadata = extractMetadata(html);

  return {
    url,
    title: metadata.title ?? "",
    content,
    metadata: {
      description: metadata.description,
      author: metadata.author,
      publishedAt: metadata.publishedAt,
    },
    tier: "basic",
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Fetch Basic endpoint handler
 * POST /fetch/basic
 */
export async function fetchBasic(c: Context<{ Bindings: Env }>) {
  const requestId = c.get("requestId");

  try {
    const { url, timeout } = c.get("validatedBody") as z.infer<typeof FetchRequestSchema>;

    // Validate URL
    const urlValidation = validateURL(url);
    if (!urlValidation.valid) {
      return c.json({
        error: "INVALID_URL",
        code: "INVALID_URL",
        message: urlValidation.error ?? "Invalid URL",
        requestId,
      }, 400);
    }

    // Fetch the page
    const result = await fetchBasicPage(urlValidation.normalized ?? url, timeout);

    const response: FetchResponse = {
      ...result,
      requestId,
    };

    return c.json(response);
  } catch (error) {
    const { code, status, message } = classifyFetchError(error);
    return c.json(createErrorResponse(code, message, requestId), status);
  }
}
