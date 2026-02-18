/**
 * Fetch Basic Endpoint Handler
 * Fetches webpage without JavaScript rendering (basic tier)
 * 
 * Requirements: 2.1, 2.5
 * - Price: $0.005
 * - No JS rendering
 * - Includes tier metadata in response
 */

import type { Context } from "hono";
import { z } from "zod/v4";
import { hashContent, signContext } from "../services/crypto";
import { validateURL } from "../services/validator";
import type { Env, FetchRequest, FetchResponse, ProofOfContext } from "../types";
import { htmlToMarkdown, extractMetadata } from "../utils/parser";
import { generateRequestId } from "../utils/requestId";

const fetchBasicSchema = z.object({
  url: z.url(),
  timeout: z.number().min(1000).max(30000).default(10000),
  cache: z.boolean().optional(),
  cacheTtl: z.number().min(60).max(86400).optional(),
});

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
  env?: Env
): Promise<FetchBasicResult & { proof?: ProofOfContext }> {
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
    throw new Error(`Failed to fetch: ${String(response.status)} ${response.statusText}`);
  }

  const html = await response.text();
  const content = htmlToMarkdown(html);
  const metadata = extractMetadata(html);

  const result: FetchBasicResult & { proof?: ProofOfContext } = {
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

  // Generate ACV Proof if environment provided
  if (env && (env.SIGNING_PRIVATE_KEY || env.CDP_API_KEY_SECRET)) {
    try {
      const hash = await hashContent(html);
      const { signature, publicKey } = await signContext(url, hash, result.fetchedAt, env);
      result.proof = {
        hash,
        timestamp: result.fetchedAt,
        signature,
        publicKey
      };
    } catch (e) {
      console.warn("Failed to generate ACV proof:", e);
    }
  }

  return result;
}

/**
 * Fetch Basic endpoint handler
 * POST /fetch/basic
 */
export async function fetchBasic(c: Context<{ Bindings: Env }>) {
  const requestId = generateRequestId();

  try {
    const body = await c.req.json<FetchRequest>();
    const parsed = fetchBasicSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({
        error: "INVALID_REQUEST",
        code: "INVALID_REQUEST",
        message: "Invalid request parameters",
        requestId,
        details: parsed.error.issues,
      }, 400);
    }

    const { url, timeout } = parsed.data;

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

    // Fetch the page with ACV
    const result = await fetchBasicPage(urlValidation.normalized ?? url, timeout, c.env);

    const response: FetchResponse = {
      ...result,
      requestId,
    };

    return c.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    // Check for timeout errors
    if (message.includes("timeout") || message.includes("aborted")) {
      return c.json({
        error: "FETCH_TIMEOUT",
        code: "FETCH_TIMEOUT",
        message: "Target URL failed to respond within timeout period",
        requestId,
      }, 502);
    }

    return c.json({
      error: "INTERNAL_ERROR",
      code: "INTERNAL_ERROR",
      message,
      requestId,
    }, 500);
  }
}
