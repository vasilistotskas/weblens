/**
 * Dynamically-priced endpoints (/fetch/pro, /extract) must advertise the BASE
 * price to unauthenticated probes, whose body is never validated.
 *
 * Regression: `getComplexityMultiplier` treats an unparseable URL as medium
 * complexity (1.5x), so a bare `{}` probe was quoted $0.045 for /extract
 * instead of the $0.03 base — observed live in production. Real bodies must
 * still get the complexity-adjusted price.
 */

import { describe, expect, it } from "vitest";
import { PRICING } from "../../src/config";
import { complexityPricing } from "../../src/endpoints/define";
import { parsePrice } from "../../src/services/pricing";

const extract = complexityPricing("extract");
const fetchPro = complexityPricing("fetch-pro");

describe("dynamic pricing for probes", () => {
    it("quotes the base price when there is no validated body", () => {
        expect(parsePrice(extract.resolve(undefined))).toBe(parsePrice(PRICING.extract));
        expect(parsePrice(fetchPro.resolve(undefined))).toBe(parsePrice(PRICING.fetch.pro));
    });

    it("still applies complexity pricing to real bodies", () => {
        expect(parsePrice(extract.resolve({ url: "https://example.com" }))).toBe(parsePrice(PRICING.extract));
        expect(parsePrice(extract.resolve({ url: "https://twitter.com/x/status/1" }))).toBe(parsePrice(PRICING.extract) * 3);
    });

    it("never quotes a probe more than a simple real request", () => {
        for (const model of [extract, fetchPro]) {
            expect(parsePrice(model.resolve(undefined))).toBeLessThanOrEqual(parsePrice(model.resolve({ url: "https://example.com" })));
        }
    });
});
