/**
 * Property-Based Tests for Intel Schema Validation
 *
 * **Feature: Knowledge Arbitrageur, Property: Intel schema validation**
 * **Validates: Input validation for /intel/* endpoints**
 *
 * For any /intel/* request, the handler SHALL reject malformed inputs
 * with a 400 error and accept properly structured inputs.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { companySchema, marketSchema, competitiveSchema, siteAuditSchema } from "../../src/tools/intel";

describe("Property: Intel schema validation", () => {
    // ============================================
    // /intel/company schema
    // ============================================

    describe("/intel/company schema", () => {
        /**
         * Property: Valid company targets are accepted
         * For any non-empty string ≤200 chars, safeParse SHALL succeed
         */
        it("accepts any non-empty string up to 200 chars", () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
                    (target) => {
                        const result = companySchema.safeParse({ target });
                        expect(result.success).toBe(true);
                    },
                ),
                { numRuns: 200 },
            );
        });

        /**
         * Property: Empty targets are rejected
         */
        it("rejects empty target strings", () => {
            const result = companySchema.safeParse({ target: "" });
            expect(result.success).toBe(false);
        });

        /**
         * Property: Missing target field is rejected
         */
        it("rejects missing target field", () => {
            fc.assert(
                fc.property(
                    fc.object(),
                    (body) => {
                        if ("target" in body) { return; }
                        const result = companySchema.safeParse(body);
                        expect(result.success).toBe(false);
                    },
                ),
                { numRuns: 100 },
            );
        });
    });

    // ============================================
    // /intel/market schema
    // ============================================

    describe("/intel/market schema", () => {
        /**
         * Property: Valid market requests are accepted
         * For any valid topic + depth combination, safeParse SHALL succeed
         */
        it("accepts valid topic with any allowed depth", () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 500 }).filter((s) => s.trim().length > 0),
                    fc.constantFrom("quick", "standard", "comprehensive"),
                    (topic, depth) => {
                        const result = marketSchema.safeParse({ topic, depth });
                        expect(result.success).toBe(true);
                    },
                ),
                { numRuns: 200 },
            );
        });

        /**
         * Property: Depth defaults to "standard" when omitted
         */
        it("defaults depth to 'standard' when not provided", () => {
            const result = marketSchema.safeParse({ topic: "test topic" });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.depth).toBe("standard");
            }
        });

        /**
         * Property: Invalid depth values are rejected
         */
        it("rejects invalid depth values", () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 500 }).filter((s) => s.trim().length > 0),
                    fc.string({ minLength: 1, maxLength: 50 }).filter(
                        (s) => !["quick", "standard", "comprehensive"].includes(s),
                    ),
                    (topic, depth) => {
                        const result = marketSchema.safeParse({ topic, depth });
                        expect(result.success).toBe(false);
                    },
                ),
                { numRuns: 100 },
            );
        });

        /**
         * Property: Focus is optional
         */
        it("accepts requests with and without focus", () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 500 }).filter((s) => s.trim().length > 0),
                    fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
                    (topic, focus) => {
                        const result = marketSchema.safeParse({ topic, focus });
                        expect(result.success).toBe(true);
                    },
                ),
                { numRuns: 200 },
            );
        });
    });

    // ============================================
    // /intel/competitive schema
    // ============================================

    describe("/intel/competitive schema", () => {
        /**
         * Property: Valid competitive requests are accepted
         */
        it("accepts valid company with competitor count 1-10", () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
                    fc.integer({ min: 1, max: 10 }),
                    (company, maxCompetitors) => {
                        const result = competitiveSchema.safeParse({ company, maxCompetitors });
                        expect(result.success).toBe(true);
                    },
                ),
                { numRuns: 200 },
            );
        });

        /**
         * Property: maxCompetitors defaults to 5 when omitted
         */
        it("defaults maxCompetitors to 5 when not provided", () => {
            const result = competitiveSchema.safeParse({ company: "test.com" });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.maxCompetitors).toBe(5);
            }
        });

        /**
         * Property: Competitor counts outside 1-10 are rejected
         */
        it("rejects maxCompetitors outside 1-10 range", () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
                    fc.oneof(
                        fc.integer({ min: -100, max: 0 }),
                        fc.integer({ min: 11, max: 100 }),
                    ),
                    (company, maxCompetitors) => {
                        const result = competitiveSchema.safeParse({ company, maxCompetitors });
                        expect(result.success).toBe(false);
                    },
                ),
                { numRuns: 100 },
            );
        });
    });

    // ============================================
    // /intel/site-audit schema
    // ============================================

    describe("/intel/site-audit schema", () => {
        /**
         * Property: Valid URLs are accepted
         */
        it("accepts valid HTTP and HTTPS URLs", () => {
            fc.assert(
                fc.property(
                    fc.webUrl(),
                    (url) => {
                        const result = siteAuditSchema.safeParse({ url });
                        expect(result.success).toBe(true);
                    },
                ),
                { numRuns: 200 },
            );
        });

        /**
         * Property: Non-URL strings are rejected
         * z.url() uses the URL constructor, which accepts many protocols.
         * We exclude any string containing "://" to avoid false positives.
         */
        it("rejects non-URL strings", () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 200 }).filter((s) => !s.includes("://")),
                    (notUrl) => {
                        const result = siteAuditSchema.safeParse({ url: notUrl });
                        expect(result.success).toBe(false);
                    }
                ),
                { numRuns: 100 }
            );
        });

        /**
         * Property: Missing url field is rejected
         */
        it("rejects missing url field", () => {
            const result = siteAuditSchema.safeParse({});
            expect(result.success).toBe(false);
        });
    });
});
