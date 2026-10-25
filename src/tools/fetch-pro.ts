/**
 * Fetch Pro Endpoint Handler
 * Fetches webpage with full JavaScript rendering (pro tier)
 * 
 * Requirements: 2.2, 2.4, 2.5
 * - Price: PRICING.fetch.pro
 * - Full JS rendering using Cloudflare Browser Rendering
 * - Waits for page to fully load including dynamic content
 * - Includes tier metadata in response
 */

import puppeteer from "@cloudflare/puppeteer";
import type { Context } from "hono";
import type { z } from "zod/v4";
import { VIEWPORT_BOUNDS } from "../config";
import type { FetchRequestSchema } from "../schemas";
import { validateURL } from "../services/validator";
import type { AppEnv, FetchResponse } from "../types";
import { hardenPage } from "../utils/browser-guard";
import { htmlToMarkdown, extractMetadata } from "../utils/parser";

export interface FetchProResult {
  url: string;
  title: string;
  content: string;
  metadata: {
    description?: string;
    author?: string;
    publishedAt?: string;
  };
  tier: "pro";
  fetchedAt: string;
}

/**
 * Sleep utility for retry delays
 */
async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch a webpage with retry logic for timeouts and network errors
 *
 * @param browserBinding - Cloudflare Browser Rendering binding
 * @param url - The URL to fetch
 * @param timeout - Request timeout in milliseconds
 * @param waitFor - Optional CSS selector to wait for
 * @param retryCount - Current retry attempt (internal)
 * @returns The fetched page content and metadata
 */
async function fetchProPageWithRetry(
  browserBinding: Fetcher,
  url: string,
  timeout: number = 10000,
  waitFor?: string,
  retryCount: number = 0
): Promise<FetchProResult> {
  const maxRetries = 2;
  const baseDelay = 1000; // Start with 1 second

  try {
    return await fetchProPageInternal(browserBinding, url, timeout, waitFor);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if it's a retryable error (timeout, network, rate limit)
    const isRetryable =
      errorMessage.includes("timeout") ||
      errorMessage.includes("Timeout") ||
      errorMessage.includes("aborted") ||
      errorMessage.includes("429") ||
      errorMessage.includes("Rate limit") ||
      errorMessage.includes("net::");

    if (isRetryable && retryCount < maxRetries) {
      // Exponential backoff: 1s, 2s
      const delay = baseDelay * Math.pow(2, retryCount);
      await sleep(delay);
      return fetchProPageWithRetry(browserBinding, url, timeout, waitFor, retryCount + 1);
    }

    // Not retryable or max retries exceeded
    throw error;
  }
}

/**
 * Internal fetch implementation with fallback wait strategies
 */
async function fetchProPageInternal(
  browserBinding: Fetcher,
  url: string,
  timeout: number = 10000,
  waitFor?: string
): Promise<FetchProResult> {
  const browser = await puppeteer.launch(browserBinding);

  try {
    const page = await browser.newPage();

    // Re-validate every request the browser makes (redirect hops,
    // subresources) against the SSRF rules — page.goto follows redirects
    // internally, bypassing safeFetch's per-hop revalidation.
    await hardenPage(page);

    // Set viewport to default dimensions
    await page.setViewport({
      width: VIEWPORT_BOUNDS.width.default,
      height: VIEWPORT_BOUNDS.height.default,
    });

    // Try networkidle0 first (strictest), fallback to domcontentloaded if timeout
    try {
      // Navigate to the URL and wait for network to be idle
      // This ensures dynamic content is fully loaded
      await page.goto(url, {
        waitUntil: "networkidle0",
        timeout,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // If networkidle0 times out, try a less strict strategy
      if (errorMessage.includes("timeout") || errorMessage.includes("Timeout")) {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: timeout / 2,
        });
      } else {
        throw error;
      }
    }

    // If a specific selector is provided, wait for it
    if (waitFor) {
      await page.waitForSelector(waitFor, { timeout: timeout / 2 });
    }

    // Get the fully rendered HTML
    const html = await page.content();

    // Extract title from the page (more reliable than parsing HTML)
    const pageTitle = await page.title();

    // Convert to markdown and extract metadata
    const content = htmlToMarkdown(html);
    const metadata = extractMetadata(html);

    const result: FetchProResult = {
      url,
      title: (pageTitle !== "" ? pageTitle : metadata.title) ?? "",
      content,
      metadata: {
        description: metadata.description,
        author: metadata.author,
        publishedAt: metadata.publishedAt,
      },
      tier: "pro",
      fetchedAt: new Date().toISOString(),
    };

    return result;
  } finally {
    await browser.close();
  }
}

/**
 * Fetch a webpage with full JavaScript rendering (public API with retry logic)
 *
 * @param browserBinding - Cloudflare Browser Rendering binding
 * @param url - The URL to fetch
 * @param timeout - Request timeout in milliseconds
 * @param waitFor - Optional CSS selector to wait for
 * @returns The fetched page content and metadata
 */
async function fetchProPage(
  browserBinding: Fetcher,
  url: string,
  timeout: number = 10000,
  waitFor?: string
): Promise<FetchProResult> {
  return fetchProPageWithRetry(browserBinding, url, timeout, waitFor);
}

/**
 * Fetch Pro endpoint handler
 * POST /fetch/pro
 */
export async function fetchPro(c: Context<AppEnv>) {
  const requestId = c.get("requestId");

  try {
    const { url, timeout, waitFor } = c.get("validatedBody") as z.infer<typeof FetchRequestSchema>;

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

    // Check if browser binding is available
    if (!c.env.BROWSER) {
      return c.json({
        error: "SERVICE_UNAVAILABLE",
        code: "SERVICE_UNAVAILABLE",
        message: "Browser rendering service is not available",
        requestId,
      }, 503);
    }

    // Fetch the page with JS rendering
    const result = await fetchProPage(
      c.env.BROWSER,
      urlValidation.normalized ?? url,
      timeout,
      waitFor
    );

    const response: FetchResponse = {
      ...result,
      requestId,
    };

    return c.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    // Check for timeout errors
    if (message.includes("timeout") || message.includes("Timeout") || message.includes("aborted")) {
      return c.json({
        error: "FETCH_TIMEOUT",
        code: "FETCH_TIMEOUT",
        message: "Target URL failed to respond within timeout period",
        requestId,
      }, 502);
    }

    // Check for render failures
    if (message.includes("Navigation") || message.includes("net::")) {
      return c.json({
        error: "RENDER_FAILED",
        code: "RENDER_FAILED",
        message: `Browser rendering failed: ${message}`,
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
