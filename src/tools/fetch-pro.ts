/**
 * Fetch Pro Endpoint Handler
 * Fetches webpage with full JavaScript rendering (pro tier)
 * 
 * Requirements: 2.2, 2.4, 2.5
 * - Price: $0.015
 * - Full JS rendering using Cloudflare Browser Rendering
 * - Waits for page to fully load including dynamic content
 * - Includes tier metadata in response
 */

import puppeteer from "@cloudflare/puppeteer";
import type { Context } from "hono";
import { z } from "zod/v4";
import { VIEWPORT_BOUNDS } from "../config";
import { validateURL } from "../services/validator";
import type { Env, FetchRequest, FetchResponse } from "../types";
import { htmlToMarkdown, extractMetadata } from "../utils/parser";
import { generateRequestId } from "../utils/requestId";

const fetchProSchema = z.object({
  url: z.url(),
  timeout: z.number().min(5000).max(30000).default(10000),
  cache: z.boolean().optional(),
  cacheTtl: z.number().min(60).max(86400).optional(),
  waitFor: z.string().optional(), // CSS selector to wait for
});

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
 * Fetch a webpage with full JavaScript rendering
 * 
 * @param browserBinding - Cloudflare Browser Rendering binding
 * @param url - The URL to fetch
 * @param timeout - Request timeout in milliseconds
 * @param waitFor - Optional CSS selector to wait for
 * @returns The fetched page content and metadata
 */
export async function fetchProPage(
  browserBinding: Fetcher,
  url: string,
  timeout: number = 10000,
  waitFor?: string
): Promise<FetchProResult> {
  const browser = await puppeteer.launch(browserBinding);
  
  try {
    const page = await browser.newPage();
    
    // Set viewport to default dimensions
    await page.setViewport({
      width: VIEWPORT_BOUNDS.width.default,
      height: VIEWPORT_BOUNDS.height.default,
    });

    // Navigate to the URL and wait for network to be idle
    // This ensures dynamic content is fully loaded
    await page.goto(url, {
      waitUntil: "networkidle0",
      timeout,
    });

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

    return {
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
  } finally {
    await browser.close();
  }
}

/**
 * Fetch Pro endpoint handler
 * POST /fetch/pro
 */
export async function fetchPro(c: Context<{ Bindings: Env }>) {
  const requestId = generateRequestId();
  
  try {
    const body = await c.req.json<FetchRequest>();
    const parsed = fetchProSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({
        error: "INVALID_REQUEST",
        code: "INVALID_REQUEST",
        message: "Invalid request parameters",
        requestId,
        details: parsed.error.issues,
      }, 400);
    }

    const { url, timeout, waitFor } = parsed.data;

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
