/**
 * Request-contract tests for the tiered fetch endpoints.
 *
 * Tests the REAL canonical schema (FetchRequestSchema) consumed via
 * validatedBody: cache defaults, cacheTtl bounds (60–86400), and the shared
 * timeout floor (5000ms) — the last reconciled from a handler that previously
 * allowed 1000ms. (The response `tier` field is "basic"|"pro" by the
 * FetchResponse type, guaranteed at compile time.)
 */

import { describe, it, expect } from "vitest";
import { FetchRequestSchema } from "../../src/schemas";

describe("FetchRequestSchema (tiered fetch request contract)", () => {
    it("applies cache + timeout defaults", () => {
        const r = FetchRequestSchema.safeParse({ url: "https://example.com" });
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.cache).toBe(true);
            expect(r.data.cacheTtl).toBe(3600);
            expect(r.data.timeout).toBe(10000);
        }
    });

    it("clamps cacheTtl to the 60–86400s window", () => {
        expect(FetchRequestSchema.safeParse({ url: "https://e.com", cacheTtl: 59 }).success).toBe(false);
        expect(FetchRequestSchema.safeParse({ url: "https://e.com", cacheTtl: 86401 }).success).toBe(false);
        expect(FetchRequestSchema.safeParse({ url: "https://e.com", cacheTtl: 3600 }).success).toBe(true);
    });

    it("rejects an invalid URL and enforces the 5000ms timeout floor", () => {
        expect(FetchRequestSchema.safeParse({ url: "not-a-url" }).success).toBe(false);
        expect(FetchRequestSchema.safeParse({ url: "https://e.com", timeout: 1000 }).success).toBe(false);
        expect(FetchRequestSchema.safeParse({ url: "https://e.com", timeout: 5000 }).success).toBe(true);
    });

    it("allows opting out of caching", () => {
        const r = FetchRequestSchema.safeParse({ url: "https://e.com", cache: false });
        expect(r.success).toBe(true);
        if (r.success) { expect(r.data.cache).toBe(false); }
    });
});
