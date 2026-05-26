/**
 * Request-contract tests for the smart-extract endpoint.
 *
 * Tests the REAL canonical schema (SmartExtractRequestSchema) consumed via
 * validatedBody. Notably locks in that `format` is json|text only — the AI
 * service cannot produce markdown (reconciled drift from the consistency pass).
 */

import { describe, it, expect } from "vitest";
import { SmartExtractRequestSchema } from "../../src/schemas";

describe("SmartExtractRequestSchema (request contract)", () => {
    it("defaults format to json", () => {
        const r = SmartExtractRequestSchema.safeParse({ url: "https://example.com", query: "emails" });
        expect(r.success).toBe(true);
        if (r.success) { expect(r.data.format).toBe("json"); }
    });

    it("accepts json and text formats", () => {
        expect(SmartExtractRequestSchema.safeParse({ url: "https://e.com", query: "x", format: "text" }).success).toBe(true);
        expect(SmartExtractRequestSchema.safeParse({ url: "https://e.com", query: "x", format: "json" }).success).toBe(true);
    });

    it("rejects markdown (the handler cannot produce it)", () => {
        expect(SmartExtractRequestSchema.safeParse({ url: "https://e.com", query: "x", format: "markdown" }).success).toBe(false);
    });

    it("rejects a missing query or invalid URL", () => {
        expect(SmartExtractRequestSchema.safeParse({ url: "https://e.com" }).success).toBe(false);
        expect(SmartExtractRequestSchema.safeParse({ url: "not-a-url", query: "x" }).success).toBe(false);
    });
});
