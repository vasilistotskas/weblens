/**
 * Batch Fetch Service
 * Fetches multiple URLs in parallel with graceful error handling
 *
 * Requirements: 1.1, 1.5
 * - Fetch all URLs in parallel
 * - Handle partial failures gracefully
 */

import type { BatchFetchResult, PageMetadata } from "../types";
import { fetchBasicPage } from "../tools/fetch-basic";

/**
 * Fetch a single URL and return a BatchFetchResult
 * Handles errors gracefully, returning error status instead of throwing
 */
async function fetchSingleUrl(
  url: string,
  timeout: number
): Promise<BatchFetchResult> {
  try {
    const result = await fetchBasicPage(url, timeout);
    return {
      url,
      status: "success",
      content: result.content,
      title: result.title,
      metadata: result.metadata as PageMetadata,
      fetchedAt: result.fetchedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      url,
      status: "error",
      error: message,
      fetchedAt: new Date().toISOString(),
    };
  }
}

/**
 * Fetch multiple URLs in parallel
 *
 * @param urls - Array of URLs to fetch (2-20)
 * @param timeout - Per-URL timeout in milliseconds
 * @returns Array of BatchFetchResult for each URL
 */
export async function batchFetch(
  urls: string[],
  timeout: number = 10000
): Promise<BatchFetchResult[]> {
  // Fetch all URLs in parallel using Promise.all
  // Each individual fetch handles its own errors, so Promise.all won't reject
  const results = await Promise.all(
    urls.map((url) => fetchSingleUrl(url, timeout))
  );

  return results;
}
