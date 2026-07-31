/**
 * Canonical Zod contract for /map and /crawl request bodies — the same
 * schemas the handlers consume via validatedBody, and the same bounds the
 * x402 price resolvers depend on (crawl price = limit x perPage, so the
 * limit bounds are also the price bounds).
 */

import { describe, expect, it } from "vitest";
import { PRICING } from "../../src/config";
import { MapRequestSchema, CrawlRequestSchema } from "../../src/schemas";

describe("MapRequestSchema", () => {
    it("applies defaults to a minimal body", () => {
        const parsed = MapRequestSchema.parse({ url: "https://example.com" });
        expect(parsed).toMatchObject({ url: "https://example.com", limit: 1000, include: [], exclude: [] });
    });

    it("rejects a missing or malformed url", () => {
        expect(MapRequestSchema.safeParse({}).success).toBe(false);
        expect(MapRequestSchema.safeParse({ url: "not-a-url" }).success).toBe(false);
    });

    it("enforces the limit bounds", () => {
        expect(MapRequestSchema.safeParse({ url: "https://e.com", limit: 0 }).success).toBe(false);
        expect(MapRequestSchema.safeParse({ url: "https://e.com", limit: 5001 }).success).toBe(false);
        expect(MapRequestSchema.safeParse({ url: "https://e.com", limit: 5000 }).success).toBe(true);
    });

    it("caps the number of path filters", () => {
        const many = Array.from({ length: 21 }, (_, i) => `/p${String(i)}`);
        expect(MapRequestSchema.safeParse({ url: "https://e.com", exclude: many }).success).toBe(false);
    });
});

describe("CrawlRequestSchema", () => {
    it("applies defaults to a minimal body", () => {
        const parsed = CrawlRequestSchema.parse({ url: "https://example.com" });
        expect(parsed).toMatchObject({
            limit: 10,
            maxDepth: 2,
            include: [],
            exclude: [],
            respectRobots: true,
            maxChars: 8000,
        });
    });

    it("keeps the page budget inside the priced range", () => {
        const { minPages, maxPages } = PRICING.crawl;
        expect(CrawlRequestSchema.safeParse({ url: "https://e.com", limit: minPages }).success).toBe(true);
        expect(CrawlRequestSchema.safeParse({ url: "https://e.com", limit: maxPages }).success).toBe(true);
        expect(CrawlRequestSchema.safeParse({ url: "https://e.com", limit: minPages - 1 }).success).toBe(false);
        expect(CrawlRequestSchema.safeParse({ url: "https://e.com", limit: maxPages + 1 }).success).toBe(false);
    });

    it("enforces the depth bounds", () => {
        expect(CrawlRequestSchema.safeParse({ url: "https://e.com", maxDepth: 0 }).success).toBe(true);
        expect(CrawlRequestSchema.safeParse({ url: "https://e.com", maxDepth: 3 }).success).toBe(true);
        expect(CrawlRequestSchema.safeParse({ url: "https://e.com", maxDepth: 4 }).success).toBe(false);
        expect(CrawlRequestSchema.safeParse({ url: "https://e.com", maxDepth: -1 }).success).toBe(false);
    });

    it("enforces the per-page content cap bounds", () => {
        expect(CrawlRequestSchema.safeParse({ url: "https://e.com", maxChars: 499 }).success).toBe(false);
        expect(CrawlRequestSchema.safeParse({ url: "https://e.com", maxChars: 50001 }).success).toBe(false);
    });

    it("allows opting out of robots for self-owned sites", () => {
        const parsed = CrawlRequestSchema.parse({ url: "https://e.com", respectRobots: false });
        expect(parsed.respectRobots).toBe(false);
    });

    it("strips unknown fields", () => {
        const parsed = CrawlRequestSchema.parse({ url: "https://e.com", sneaky: "value" });
        expect(parsed).not.toHaveProperty("sneaky");
    });
});

describe("crawl pricing bounds", () => {
    it("prices the default budget well above zero and the max sanely", () => {
        const perPage = parseFloat(PRICING.crawl.perPage.replace("$", ""));
        expect(perPage).toBeGreaterThan(0);
        expect(perPage * PRICING.crawl.maxPages).toBeLessThan(0.1);
    });
});
