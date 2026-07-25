/**
 * Request-contract tests for the search-vertical, social, contents, and
 * answer endpoints — testing the REAL canonical Zod schemas consumed via
 * validatedBody, plus the extended SearchRequestSchema (includeContent).
 */

import { describe, expect, it } from "vitest";
import {
    AnswerRequestSchema,
    ContentsRequestSchema,
    PlacesSearchRequestSchema,
    SearchRequestSchema,
    TrendsRequestSchema,
    VerticalSearchRequestSchema,
    YoutubeTranscriptRequestSchema,
} from "../../src/schemas";

describe("VerticalSearchRequestSchema (news/images/shopping/scholar/autocomplete)", () => {
    it("parses a minimal body and applies the limit default", () => {
        const r = VerticalSearchRequestSchema.safeParse({ query: "ai news" });
        expect(r.success).toBe(true);
        if (r.success) { expect(r.data.limit).toBe(10); }
    });

    it("rejects an empty query and out-of-bounds limits", () => {
        expect(VerticalSearchRequestSchema.safeParse({ query: "" }).success).toBe(false);
        expect(VerticalSearchRequestSchema.safeParse({ query: "q", limit: 0 }).success).toBe(false);
        expect(VerticalSearchRequestSchema.safeParse({ query: "q", limit: 21 }).success).toBe(false);
        expect(VerticalSearchRequestSchema.safeParse({ query: "q", limit: 20 }).success).toBe(true);
    });
});

describe("PlacesSearchRequestSchema", () => {
    it("parses with and without the optional location", () => {
        const r = PlacesSearchRequestSchema.safeParse({ query: "coffee shops" });
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.location).toBeUndefined();
            expect(r.data.limit).toBe(10);
        }
        const withLoc = PlacesSearchRequestSchema.safeParse({ query: "coffee shops", location: "Austin, Texas" });
        expect(withLoc.success).toBe(true);
        if (withLoc.success) { expect(withLoc.data.location).toBe("Austin, Texas"); }
    });

    it("rejects an empty query and a too-short location", () => {
        expect(PlacesSearchRequestSchema.safeParse({ query: "" }).success).toBe(false);
        expect(PlacesSearchRequestSchema.safeParse({ query: "q", location: "a" }).success).toBe(false);
    });
});

describe("TrendsRequestSchema", () => {
    it("parses a minimal body", () => {
        expect(TrendsRequestSchema.safeParse({ query: "cloudflare workers" }).success).toBe(true);
    });

    it("rejects an empty or missing query", () => {
        expect(TrendsRequestSchema.safeParse({ query: "" }).success).toBe(false);
        expect(TrendsRequestSchema.safeParse({}).success).toBe(false);
    });
});

describe("YoutubeTranscriptRequestSchema", () => {
    it("accepts a bare ID and a full URL, with optional lang", () => {
        expect(YoutubeTranscriptRequestSchema.safeParse({ videoId: "dQw4w9WgXcQ" }).success).toBe(true);
        expect(YoutubeTranscriptRequestSchema.safeParse({
            videoId: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            lang: "en",
        }).success).toBe(true);
    });

    it("rejects a too-short videoId and out-of-bounds lang", () => {
        expect(YoutubeTranscriptRequestSchema.safeParse({ videoId: "abcd" }).success).toBe(false);
        expect(YoutubeTranscriptRequestSchema.safeParse({ videoId: "dQw4w9WgXcQ", lang: "e" }).success).toBe(false);
    });
});

describe("ContentsRequestSchema", () => {
    it("parses a minimal body and applies maxChars + timeout defaults", () => {
        const r = ContentsRequestSchema.safeParse({ urls: ["https://example.com/article"] });
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.maxChars).toBe(20000);
            expect(r.data.timeout).toBe(10000);
        }
    });

    it("enforces the 1-20 urls window", () => {
        expect(ContentsRequestSchema.safeParse({ urls: [] }).success).toBe(false);
        const twentyOne = Array.from({ length: 21 }, (_, i) => `https://example.com/${i}`);
        expect(ContentsRequestSchema.safeParse({ urls: twentyOne }).success).toBe(false);
        expect(ContentsRequestSchema.safeParse({ urls: twentyOne.slice(0, 20) }).success).toBe(true);
    });

    it("rejects invalid URLs and out-of-bounds maxChars", () => {
        expect(ContentsRequestSchema.safeParse({ urls: ["not-a-url"] }).success).toBe(false);
        expect(ContentsRequestSchema.safeParse({ urls: ["https://e.com"], maxChars: 499 }).success).toBe(false);
        expect(ContentsRequestSchema.safeParse({ urls: ["https://e.com"], maxChars: 50001 }).success).toBe(false);
    });
});

describe("AnswerRequestSchema", () => {
    it("parses a minimal body and applies the sources default", () => {
        const r = AnswerRequestSchema.safeParse({ query: "What is x402?" });
        expect(r.success).toBe(true);
        if (r.success) { expect(r.data.sources).toBe(3); }
    });

    it("enforces the 1-5 sources window and rejects an empty query", () => {
        expect(AnswerRequestSchema.safeParse({ query: "" }).success).toBe(false);
        expect(AnswerRequestSchema.safeParse({ query: "q", sources: 0 }).success).toBe(false);
        expect(AnswerRequestSchema.safeParse({ query: "q", sources: 6 }).success).toBe(false);
        expect(AnswerRequestSchema.safeParse({ query: "q", sources: 5 }).success).toBe(true);
    });
});

describe("SearchRequestSchema (includeContent extension)", () => {
    it("applies includeContent/contentResults/contentChars defaults", () => {
        const r = SearchRequestSchema.safeParse({ query: "x402" });
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.includeContent).toBe(false);
            expect(r.data.contentResults).toBe(5);
            expect(r.data.contentChars).toBe(8000);
        }
    });

    it("enforces contentResults (1-10) and contentChars (500-20000) bounds", () => {
        expect(SearchRequestSchema.safeParse({ query: "q", contentResults: 0 }).success).toBe(false);
        expect(SearchRequestSchema.safeParse({ query: "q", contentResults: 11 }).success).toBe(false);
        expect(SearchRequestSchema.safeParse({ query: "q", contentChars: 499 }).success).toBe(false);
        expect(SearchRequestSchema.safeParse({ query: "q", contentChars: 20001 }).success).toBe(false);
        expect(SearchRequestSchema.safeParse({
            query: "q", includeContent: true, contentResults: 10, contentChars: 20000,
        }).success).toBe(true);
    });
});
