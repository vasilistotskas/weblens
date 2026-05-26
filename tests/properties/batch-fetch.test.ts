/**
 * Request-contract tests for the batch-fetch endpoint.
 *
 * Tests the REAL canonical schema (BatchFetchRequestSchema) that the handler
 * consumes via validatedBody — bounds (2–20 URLs), URL validity, tier enum,
 * and defaults — rather than a local mock.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { PRICING } from "../../src/config";
import { BatchFetchRequestSchema } from "../../src/schemas";

describe("BatchFetchRequestSchema (request contract)", () => {
    it("accepts any 2–20 valid URLs and applies defaults", () => {
        fc.assert(
            fc.property(
                fc.array(fc.webUrl(), {
                    minLength: PRICING.batchFetch.minUrls,
                    maxLength: PRICING.batchFetch.maxUrls,
                }),
                (urls) => {
                    const r = BatchFetchRequestSchema.safeParse({ urls });
                    expect(r.success).toBe(true);
                    if (r.success) {
                        expect(r.data.urls).toHaveLength(urls.length);
                        expect(r.data.tier).toBe("basic"); // default
                        expect(r.data.timeout).toBe(10000); // shared timeout default
                    }
                },
            ),
            { numRuns: 50 },
        );
    });

    it("rejects fewer than the minimum URLs", () => {
        expect(BatchFetchRequestSchema.safeParse({ urls: ["https://a.com"] }).success).toBe(false);
        expect(BatchFetchRequestSchema.safeParse({ urls: [] }).success).toBe(false);
    });

    it("rejects more than the maximum URLs", () => {
        const urls = Array.from({ length: PRICING.batchFetch.maxUrls + 1 }, (_, i) => `https://a${String(i)}.com`);
        expect(BatchFetchRequestSchema.safeParse({ urls }).success).toBe(false);
    });

    it("rejects invalid URLs and unknown tiers", () => {
        expect(BatchFetchRequestSchema.safeParse({ urls: ["not a url", "https://b.com"] }).success).toBe(false);
        expect(
            BatchFetchRequestSchema.safeParse({ urls: ["https://a.com", "https://b.com"], tier: "ultra" }).success,
        ).toBe(false);
    });

    it("accepts the pro tier explicitly", () => {
        const r = BatchFetchRequestSchema.safeParse({ urls: ["https://a.com", "https://b.com"], tier: "pro" });
        expect(r.success).toBe(true);
    });
});
