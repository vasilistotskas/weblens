/**
 * Property-based tests for per-unit pricing (/contents per URL, /crawl per
 * requested page). One resolver formula prices both, so the properties run
 * against each product's own unit price and bounds.
 */

import * as fc from "fast-check";
import { describe, it, expect } from "vitest";
import { PRICING } from "../../src/config";
import { parsePrice, perUnitPrice } from "../../src/services/pricing";

const PRODUCTS = [
  { name: "/contents", unitPrice: PRICING.contents.perUrl, min: PRICING.contents.minUrls, max: PRICING.contents.maxUrls },
  { name: "/crawl", unitPrice: PRICING.crawl.perPage, min: PRICING.crawl.minPages, max: PRICING.crawl.maxPages },
] as const;

describe.each(PRODUCTS)("perUnitPrice for $name", ({ unitPrice, min, max }) => {
  const unit = parsePrice(unitPrice);

  it("equals units × unit price at 4 decimals", () => {
    fc.assert(
      fc.property(fc.integer({ min, max }), (units) => {
        expect(perUnitPrice(unitPrice, units)).toBe(`$${(units * unit).toFixed(4)}`);
      }),
      { numRuns: 100 },
    );
  });

  it("is linear: doubling the units doubles the price", () => {
    fc.assert(
      fc.property(fc.integer({ min, max: Math.floor(max / 2) }), (units) => {
        const single = parsePrice(perUnitPrice(unitPrice, units));
        const double = parsePrice(perUnitPrice(unitPrice, units * 2));
        expect(Math.abs(double - single * 2)).toBeLessThan(0.0001);
      }),
      { numRuns: 100 },
    );
  });

  it("increases monotonically with the unit count", () => {
    fc.assert(
      fc.property(fc.integer({ min, max: max - 1 }), (units) => {
        expect(parsePrice(perUnitPrice(unitPrice, units + 1))).toBeGreaterThan(parsePrice(perUnitPrice(unitPrice, units)));
      }),
      { numRuns: 100 },
    );
  });

  it("keeps the price per unit constant", () => {
    fc.assert(
      fc.property(fc.integer({ min, max }), (units) => {
        expect(Math.abs(parsePrice(perUnitPrice(unitPrice, units)) / units - unit)).toBeLessThan(0.0001);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Regression: at a sub-$0.001 unit price, 3-decimal formatting rounded odd
   * counts up (3 x $0.0015 = $0.0045 -> "$0.005"), overcharging the caller.
   */
  it("does not round an odd unit count up", () => {
    for (const units of [3, 5, 7, 9].filter((n) => n >= min && n <= max)) {
      expect(parsePrice(perUnitPrice(unitPrice, units)), `${String(units)} units`).toBeCloseTo(units * unit, 6);
    }
  });

  it("prices the bounds exactly", () => {
    expect(perUnitPrice(unitPrice, min)).toBe(`$${(min * unit).toFixed(4)}`);
    expect(perUnitPrice(unitPrice, max)).toBe(`$${(max * unit).toFixed(4)}`);
  });
});
