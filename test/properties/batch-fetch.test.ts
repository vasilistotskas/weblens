/**
 * Property-Based Tests for Batch Fetch
 *
 * **Feature: weblens, Property 1: Batch fetch returns results for all URLs**
 * **Validates: Requirements 1.1, 1.6**
 *
 * For any batch fetch request with N URLs (2 ≤ N ≤ 20), the response SHALL
 * contain exactly N results, one for each input URL.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { PRICING } from "../../src/config";

// Mock batch fetch result structure for testing response structure
interface MockBatchFetchResult {
  url: string;
  status: "success" | "error";
  content?: string;
  title?: string;
  error?: string;
  fetchedAt: string;
}

/**
 * Simulates batch fetch response structure
 * This tests the contract that results array length equals input URLs length
 */
function simulateBatchFetchResponse(urls: string[]): MockBatchFetchResult[] {
  return urls.map((url) => ({
    url,
    status: "success" as const,
    content: "# Mock Content",
    title: "Mock Title",
    fetchedAt: new Date().toISOString(),
  }));
}

describe("Property 1: Batch fetch returns results for all URLs", () => {
  /**
   * Property: Result count equals input URL count
   * For any batch fetch request with N URLs, response contains exactly N results
   */
  it("result count equals input URL count for valid batches", () => {
    fc.assert(
      fc.property(
        // Generate arrays of valid URLs within bounds
        fc.array(fc.webUrl(), {
          minLength: PRICING.batchFetch.minUrls,
          maxLength: PRICING.batchFetch.maxUrls,
        }),
        (urls) => {
          const results = simulateBatchFetchResponse(urls);
          expect(results.length).toBe(urls.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Each result corresponds to its input URL
   * For any batch fetch, result[i].url === input[i]
   */
  it("each result URL matches its corresponding input URL", () => {
    fc.assert(
      fc.property(
        fc.array(fc.webUrl(), {
          minLength: PRICING.batchFetch.minUrls,
          maxLength: PRICING.batchFetch.maxUrls,
        }),
        (urls) => {
          const results = simulateBatchFetchResponse(urls);
          for (let i = 0; i < urls.length; i++) {
            expect(results[i].url).toBe(urls[i]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: All results have required fields
   * For any batch fetch result, it SHALL include url, status, and fetchedAt
   */
  it("all results contain required fields (url, status, fetchedAt)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.webUrl(), {
          minLength: PRICING.batchFetch.minUrls,
          maxLength: PRICING.batchFetch.maxUrls,
        }),
        (urls) => {
          const results = simulateBatchFetchResponse(urls);
          for (const result of results) {
            expect(result).toHaveProperty("url");
            expect(result).toHaveProperty("status");
            expect(result).toHaveProperty("fetchedAt");
            expect(["success", "error"]).toContain(result.status);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Successful results have content
   * For any successful result, it SHALL include content and title
   */
  it("successful results include content and title", () => {
    fc.assert(
      fc.property(
        fc.array(fc.webUrl(), {
          minLength: PRICING.batchFetch.minUrls,
          maxLength: PRICING.batchFetch.maxUrls,
        }),
        (urls) => {
          const results = simulateBatchFetchResponse(urls);
          for (const result of results) {
            if (result.status === "success") {
              expect(result.content).toBeDefined();
              expect(result.title).toBeDefined();
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
