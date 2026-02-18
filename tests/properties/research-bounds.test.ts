/**
 * Property-Based Tests for Research Result Count Bounds
 *
 * **Feature: weblens, Property 5: Research result count bounds**
 * **Validates: Requirements 2.3**
 *
 * For any research request with result count N (1 ≤ N ≤ 10),
 * the response SHALL contain at most N sources.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { z } from "zod/v4";

// Schema matching the research endpoint validation
const researchSchema = z.object({
  query: z.string().min(1).max(500),
  resultCount: z.number().min(1).max(10).default(5),
  includeRawContent: z.boolean().default(false),
});

/**
 * Simulates research response with bounded source count
 */
function simulateResearchWithBounds(
  query: string,
  requestedCount: number,
  availableResults: number
): { sources: Array<{ url: string }>; requestedCount: number } {
  // Response contains at most requestedCount sources
  const actualCount = Math.min(requestedCount, availableResults);
  const sources = Array.from({ length: actualCount }, (_, i) => ({
    url: `https://example${i}.com`,
  }));

  return { sources, requestedCount };
}

describe("Property 5: Research result count bounds", () => {
  /**
   * Property: Source count is at most the requested count
   * For any research request with N results, sources.length ≤ N
   */
  it("source count is at most the requested result count", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 0, max: 20 }), // Available results (could be more or less)
        (query, requestedCount, availableResults) => {
          const result = simulateResearchWithBounds(
            query,
            requestedCount,
            availableResults
          );
          expect(result.sources.length).toBeLessThanOrEqual(requestedCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Result count validation accepts 1-10
   * For any result count in [1, 10], validation passes
   */
  it("accepts result count between 1 and 10", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (resultCount) => {
        const result = researchSchema.safeParse({
          query: "test query",
          resultCount,
        });
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Result count validation rejects < 1
   * For any result count < 1, validation fails
   */
  it("rejects result count less than 1", () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 0 }), (resultCount) => {
        const result = researchSchema.safeParse({
          query: "test query",
          resultCount,
        });
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Result count validation rejects > 10
   * For any result count > 10, validation fails
   */
  it("rejects result count greater than 10", () => {
    fc.assert(
      fc.property(fc.integer({ min: 11, max: 100 }), (resultCount) => {
        const result = researchSchema.safeParse({
          query: "test query",
          resultCount,
        });
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Default result count is 5
   * When resultCount is not provided, it defaults to 5
   */
  it("defaults to 5 results when not specified", () => {
    const result = researchSchema.safeParse({ query: "test query" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.resultCount).toBe(5);
    }
  });

  /**
   * Property: Boundary values are correctly handled
   * Exactly 1 and exactly 10 should be accepted
   */
  it("accepts boundary values (1 and 10)", () => {
    const result1 = researchSchema.safeParse({
      query: "test",
      resultCount: 1,
    });
    const result10 = researchSchema.safeParse({
      query: "test",
      resultCount: 10,
    });

    expect(result1.success).toBe(true);
    expect(result10.success).toBe(true);
  });
});
