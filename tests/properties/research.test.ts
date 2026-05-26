/**
 * Request-contract tests for the research endpoint.
 *
 * Tests the REAL canonical schema (ResearchRequestSchema) consumed via
 * validatedBody — query bounds, resultCount range, and defaults.
 */

import { describe, it, expect } from "vitest";
import { ResearchRequestSchema } from "../../src/schemas";

describe("ResearchRequestSchema (request contract)", () => {
    it("applies defaults for resultCount and includeRawContent", () => {
        const r = ResearchRequestSchema.safeParse({ query: "x402 micropayments" });
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.resultCount).toBe(5);
            expect(r.data.includeRawContent).toBe(false);
        }
    });

    it("rejects an empty or over-long query", () => {
        expect(ResearchRequestSchema.safeParse({ query: "" }).success).toBe(false);
        expect(ResearchRequestSchema.safeParse({ query: "a".repeat(501) }).success).toBe(false);
    });

    it("rejects resultCount outside 1–10", () => {
        expect(ResearchRequestSchema.safeParse({ query: "x", resultCount: 0 }).success).toBe(false);
        expect(ResearchRequestSchema.safeParse({ query: "x", resultCount: 11 }).success).toBe(false);
        expect(ResearchRequestSchema.safeParse({ query: "x", resultCount: 7 }).success).toBe(true);
    });
});
