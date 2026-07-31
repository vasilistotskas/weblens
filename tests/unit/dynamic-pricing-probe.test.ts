/**
 * Dynamically-priced endpoints (/fetch/pro, /extract) must advertise the BASE
 * price to unauthenticated probes that supply no usable URL.
 *
 * Regression: `getComplexityMultiplier` treats an unparseable URL as medium
 * complexity (1.5x), so a bare `{}` probe was quoted $0.045 for /extract
 * instead of the $0.03 base — observed live in production. Real bodies must
 * still get the complexity-adjusted price.
 */

import { describe, expect, it } from "vitest";
import { PRICING } from "../../src/config";
import { calculatePrice, parsePrice } from "../../src/services/pricing";

/**
 * Mirrors src/routes/core.ts `dynamicUrlPrice`: no usable URL → base price;
 * otherwise complexity-adjusted.
 */
async function resolvePrice(
    body: { url?: unknown } | undefined,
    endpoint: "fetch-pro" | "extract",
    fallback: string,
): Promise<string> {
    if (typeof body?.url !== "string" || body.url === "") {
        return fallback;
    }
    return calculatePrice(body.url, endpoint, 0);
}

describe("dynamic pricing for probes", () => {
    it("quotes the base price when the body has no url", async () => {
        expect(parsePrice(await resolvePrice({}, "extract", PRICING.extract)))
            .toBe(parsePrice(PRICING.extract));
        expect(parsePrice(await resolvePrice(undefined, "fetch-pro", PRICING.fetch.pro)))
            .toBe(parsePrice(PRICING.fetch.pro));
    });

    it("quotes the base price for a non-string or empty url", async () => {
        expect(parsePrice(await resolvePrice({ url: 42 }, "extract", PRICING.extract)))
            .toBe(parsePrice(PRICING.extract));
        expect(parsePrice(await resolvePrice({ url: "" }, "extract", PRICING.extract)))
            .toBe(parsePrice(PRICING.extract));
        expect(parsePrice(await resolvePrice({ url: null }, "extract", PRICING.extract)))
            .toBe(parsePrice(PRICING.extract));
    });

    it("still applies complexity pricing to real bodies", async () => {
        const simple = parsePrice(await resolvePrice({ url: "https://example.com" }, "extract", PRICING.extract));
        const complex = parsePrice(await resolvePrice({ url: "https://twitter.com/x/status/1" }, "extract", PRICING.extract));
        expect(simple).toBe(parsePrice(PRICING.extract));
        expect(complex).toBe(parsePrice(PRICING.extract) * 3);
    });

    it("never quotes a probe more than a simple real request", async () => {
        for (const [endpoint, base] of [["extract", PRICING.extract], ["fetch-pro", PRICING.fetch.pro]] as const) {
            const probe = parsePrice(await resolvePrice({}, endpoint, base));
            const real = parsePrice(await resolvePrice({ url: "https://example.com" }, endpoint, base));
            expect(probe).toBeLessThanOrEqual(real);
        }
    });
});
