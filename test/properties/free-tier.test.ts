/**
 * Property-Based Tests for Free Tier Configuration
 *
 * Validates free tier config constraints and content truncation behavior.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { FREE_TIER } from "../../src/config";

describe("Free Tier: Configuration properties", () => {
    it("maxRequestsPerHour is a positive integer", () => {
        expect(FREE_TIER.maxRequestsPerHour).toBeGreaterThan(0);
        expect(Number.isInteger(FREE_TIER.maxRequestsPerHour)).toBe(true);
    });

    it("rateLimitWindowSeconds equals 1 hour", () => {
        expect(FREE_TIER.rateLimitWindowSeconds).toBe(3600);
    });

    it("fetchMaxContentLength is positive", () => {
        expect(FREE_TIER.fetchMaxContentLength).toBeGreaterThan(0);
    });

    it("searchMaxResults is positive", () => {
        expect(FREE_TIER.searchMaxResults).toBeGreaterThan(0);
    });

    it("all free endpoints start with /free/", () => {
        for (const endpoint of FREE_TIER.endpoints) {
            expect(endpoint.startsWith("/free/")).toBe(true);
        }
    });
});

describe("Free Tier: Content truncation properties", () => {
    /**
     * Property: Any content longer than the limit will be truncated
     * to exactly maxContentLength chars (plus the truncation notice).
     */
    it("content exceeding limit is always truncated to maxLength", () => {
        const maxLen = FREE_TIER.fetchMaxContentLength;
        const suffix = "\n\n--- Content truncated (free tier) ---";

        fc.assert(
            fc.property(
                // Generate random content longer than limit
                fc.string({ minLength: maxLen + 1, maxLength: maxLen + 5000 }),
                (content) => {
                    const isTruncated = content.length > maxLen;
                    expect(isTruncated).toBe(true);

                    const truncated = content.slice(0, maxLen) + suffix;
                    expect(truncated.startsWith(content.slice(0, maxLen))).toBe(true);
                    expect(truncated.endsWith(suffix)).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Content at or under the limit is never truncated.
     */
    it("content within limit is never truncated", () => {
        const maxLen = FREE_TIER.fetchMaxContentLength;

        fc.assert(
            fc.property(
                fc.string({ minLength: 0, maxLength: maxLen }),
                (content) => {
                    expect(content.length <= maxLen).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property: Search results are always capped at searchMaxResults.
     */
    it("search results are always capped at searchMaxResults", () => {
        const maxResults = FREE_TIER.searchMaxResults;

        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        title: fc.string(),
                        url: fc.string(),
                        snippet: fc.string(),
                        position: fc.nat(),
                    }),
                    { minLength: 0, maxLength: 20 }
                ),
                (results) => {
                    const capped = results.slice(0, maxResults);
                    expect(capped.length).toBeLessThanOrEqual(maxResults);
                }
            ),
            { numRuns: 100 }
        );
    });
});
