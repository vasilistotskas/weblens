/**
 * Property-Based Tests for Batch Fetch Bounds Validation
 *
 * **Feature: weblens, Property 3: Batch fetch bounds validation**
 * **Validates: Requirements 1.2, 1.3**
 *
 * For any batch fetch request with fewer than 2 URLs or more than 20 URLs,
 * the system SHALL return a validation error.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { z } from "zod/v4";
import { PRICING } from "../../src/config";

// Schema matching the batch fetch endpoint validation
const batchFetchSchema = z.object({
  urls: z
    .array(z.string())
    .min(PRICING.batchFetch.minUrls)
    .max(PRICING.batchFetch.maxUrls),
  timeout: z.number().min(1000).max(30000).default(10000),
  tier: z.enum(["basic", "pro"]).default("basic"),
});

/**
 * Validates batch fetch request and returns error code if invalid
 */
function validateBatchRequest(urls: string[]): {
  valid: boolean;
  errorCode?: string;
} {
  const result = batchFetchSchema.safeParse({ urls });
  if (result.success) {
    return { valid: true };
  }

  const urlsIssue = result.error.issues.find((i) => i.path[0] === "urls");
  if (urlsIssue) {
    if (urls.length < PRICING.batchFetch.minUrls) {
      return { valid: false, errorCode: "BATCH_TOO_SMALL" };
    }
    if (urls.length > PRICING.batchFetch.maxUrls) {
      return { valid: false, errorCode: "BATCH_TOO_LARGE" };
    }
  }

  return { valid: false, errorCode: "INVALID_REQUEST" };
}

describe("Property 3: Batch fetch bounds validation", () => {
  /**
   * Property: Requests with fewer than 2 URLs are rejected
   * For any request with 0 or 1 URLs, system returns BATCH_TOO_SMALL error
   */
  it("rejects requests with fewer than 2 URLs", () => {
    fc.assert(
      fc.property(
        // Generate arrays with 0 or 1 URLs (below minimum)
        fc.array(fc.webUrl(), { minLength: 0, maxLength: 1 }),
        (urls) => {
          const result = validateBatchRequest(urls);
          expect(result.valid).toBe(false);
          expect(result.errorCode).toBe("BATCH_TOO_SMALL");
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Requests with more than 20 URLs are rejected
   * For any request with 21+ URLs, system returns BATCH_TOO_LARGE error
   */
  it("rejects requests with more than 20 URLs", () => {
    fc.assert(
      fc.property(
        // Generate arrays with 21-30 URLs (above maximum)
        fc.array(fc.webUrl(), { minLength: 21, maxLength: 30 }),
        (urls) => {
          const result = validateBatchRequest(urls);
          expect(result.valid).toBe(false);
          expect(result.errorCode).toBe("BATCH_TOO_LARGE");
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Requests within bounds (2-20) are accepted
   * For any request with 2-20 URLs, validation passes
   */
  it("accepts requests with 2-20 URLs", () => {
    fc.assert(
      fc.property(
        fc.array(fc.webUrl(), {
          minLength: PRICING.batchFetch.minUrls,
          maxLength: PRICING.batchFetch.maxUrls,
        }),
        (urls) => {
          const result = validateBatchRequest(urls);
          expect(result.valid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Boundary values are correctly handled
   * Exactly 2 URLs (minimum) should be accepted
   */
  it("accepts exactly 2 URLs (minimum boundary)", () => {
    fc.assert(
      fc.property(fc.tuple(fc.webUrl(), fc.webUrl()), ([url1, url2]) => {
        const result = validateBatchRequest([url1, url2]);
        expect(result.valid).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Boundary values are correctly handled
   * Exactly 20 URLs (maximum) should be accepted
   */
  it("accepts exactly 20 URLs (maximum boundary)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.webUrl(), { minLength: 20, maxLength: 20 }),
        (urls) => {
          const result = validateBatchRequest(urls);
          expect(result.valid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Just outside boundaries are rejected
   * Exactly 1 URL should be rejected
   */
  it("rejects exactly 1 URL (just below minimum)", () => {
    fc.assert(
      fc.property(fc.webUrl(), (url) => {
        const result = validateBatchRequest([url]);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe("BATCH_TOO_SMALL");
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Just outside boundaries are rejected
   * Exactly 21 URLs should be rejected
   */
  it("rejects exactly 21 URLs (just above maximum)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.webUrl(), { minLength: 21, maxLength: 21 }),
        (urls) => {
          const result = validateBatchRequest(urls);
          expect(result.valid).toBe(false);
          expect(result.errorCode).toBe("BATCH_TOO_LARGE");
        }
      ),
      { numRuns: 100 }
    );
  });
});
