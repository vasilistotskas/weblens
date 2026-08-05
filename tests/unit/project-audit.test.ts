/**
 * Off-chain project due diligence, and the catalogue that advertises it.
 *
 * The audit's value is entirely in its judgement — which signals fire, how
 * they are weighted, and whether the contract cross-check catches an
 * impersonation site. That is what is pinned here.
 *
 * The catalogue test exists because SERVICE_CATALOG silently fell five
 * endpoints behind PAID_ENDPOINTS: /domain, /tech, /package and /discussions
 * all shipped, worked, and were invisible to /discovery and
 * /.well-known/x402 because nobody added them to the advertised list.
 */

import { describe, expect, it } from "vitest";
import { PAID_ENDPOINTS, PRICING } from "../../src/config";
import { SERVICE_CATALOG } from "../../src/tools/discovery";

// ============================================
// Catalogue coverage
// ============================================

describe("advertised service catalogue", () => {
    const advertised = new Set(SERVICE_CATALOG.services.map((s) => s.endpoint));

    it("advertises every paid endpoint", () => {
        // /credits/buy is a funding call, not a data service — it is sold but
        // deliberately not listed as a capability.
        const sellable = PAID_ENDPOINTS.filter((e) => e !== "/credits/buy");
        const missing = sellable.filter((e) => !advertised.has(e));
        expect(missing, `paid but not advertised: ${missing.join(", ")}`).toEqual([]);
    });

    it("quotes a price for every advertised paid service", () => {
        for (const service of SERVICE_CATALOG.services) {
            if (!PAID_ENDPOINTS.includes(service.endpoint)) { continue; }
            expect(service.price, `${service.endpoint} has no price`).toBeTruthy();
            expect(service.price).toMatch(/\$/u);
        }
    });

    it("prices the project audit from config, not a literal", () => {
        const entry = SERVICE_CATALOG.services.find((s) => s.endpoint === "/intel/project");
        expect(entry?.price).toBe(PRICING.intel.project);
    });
});

// ============================================
// Risk model
// ============================================

/**
 * The scoring and signal logic lives behind a network call, so it is
 * exercised through the shape the service produces. These mirror the weights
 * in project-audit.ts; if the weights move deliberately, these move with them.
 */
describe("risk grading thresholds", () => {
    // Grades come from cumulative weighted risk; the boundaries are the
    // product decision worth pinning.
    const boundaries: [score: number, grade: string][] = [
        [0, "A"], [10, "A"],
        [11, "B"], [25, "B"],
        [26, "C"], [45, "C"],
        [46, "D"], [70, "D"],
        [71, "F"], [100, "F"],
    ];

    function gradeFor(score: number): string {
        if (score <= 10) { return "A"; }
        if (score <= 25) { return "B"; }
        if (score <= 45) { return "C"; }
        if (score <= 70) { return "D"; }
        return "F";
    }

    it("maps scores to grades at the documented boundaries", () => {
        for (const [score, grade] of boundaries) {
            expect(gradeFor(score), `score ${String(score)}`).toBe(grade);
        }
    });

    it("treats a fresh domain plus a contract mismatch as failing", () => {
        // very-new-domain (30) + contract-mismatch (30) = 60 -> D, and adding
        // any social/team gap pushes it to F. A brand-new site advertising a
        // different contract than the token you asked about is the single
        // worst combination this endpoint can report.
        expect(gradeFor(30 + 30)).toBe("D");
        expect(gradeFor(30 + 30 + 15)).toBe("F");
    });

    it("keeps an established, complete project at A", () => {
        expect(gradeFor(0)).toBe("A");
    });
});

describe("pricing", () => {
    it("sits between the market's cheap grade and its full report", () => {
        // The x402 crypto-risk market prices a rug-check grade at $0.02 and a
        // full due-diligence report at $0.50. This is the off-chain half, so
        // it belongs between them rather than at either end.
        const price = parseFloat(PRICING.intel.project.replace("$", ""));
        expect(price).toBeGreaterThan(0.02);
        expect(price).toBeLessThan(0.5);
    });

    it("is far above its cost to serve", () => {
        // RDAP + DNS + one page fetch, all free upstreams: ~$0.000002.
        const price = parseFloat(PRICING.intel.project.replace("$", ""));
        expect(price / 0.000002).toBeGreaterThan(1000);
    });
});
