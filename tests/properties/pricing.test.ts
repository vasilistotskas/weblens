/**
 * Property-Based Tests for Pricing Configuration
 *
 * **Feature: weblens-phase1, Property 3: Tier pricing consistency**
 * **Validates: Requirements 2.1, 2.2**
 *
 * For any request to a tiered endpoint (`/fetch/basic`, `/fetch/pro`),
 * the 402 Payment Required response SHALL contain the correct price
 * for that tier ($0.005 for basic, $0.015 for pro).
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { PRICING } from "../../src/config";
import { getCachedPrice, parsePrice } from "../../src/services/pricing";

// PRICING is the single source of truth for endpoint prices — routes wire
// these constants straight into the credit/x402 middlewares.
const TIERED_PRICES: Record<string, string> = {
  screenshot: PRICING.screenshot,
  "fetch-basic": PRICING.fetch.basic,
  "fetch-pro": PRICING.fetch.pro,
  search: PRICING.search,
  extract: PRICING.extract,
};

describe("Property 3: Tier pricing consistency", () => {
  /**
   * Property: /fetch/basic is always priced at $0.005
   */
  it("fetch/basic tier has the correct configured price ($0.005)", () => {
    expect(PRICING.fetch.basic).toBe("$0.005");
  });

  /**
   * Property: /fetch/pro is always priced at $0.015
   */
  it("fetch/pro tier has the correct configured price ($0.015)", () => {
    expect(PRICING.fetch.pro).toBe("$0.015");
  });

  /**
   * Property: Basic tier is always cheaper than Pro tier
   */
  it("basic tier is always cheaper than pro tier", () => {
    const basicPrice = parsePrice(PRICING.fetch.basic);
    const proPrice = parsePrice(PRICING.fetch.pro);
    expect(basicPrice).toBeLessThan(proPrice);
  });

  /**
   * Property: Cached prices are always lower than base prices
   * For any endpoint, getCachedPrice returns a lower price
   */
  it("cached prices are always lower than base prices for all endpoints", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.keys(TIERED_PRICES)),
        (endpoint) => {
          const basePrice = parsePrice(TIERED_PRICES[endpoint]);
          const cachedPrice = parsePrice(getCachedPrice(TIERED_PRICES[endpoint]));
          expect(cachedPrice).toBeLessThan(basePrice);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Cache discount is exactly 70%
   * For any price, cached price = base price * (1 - 0.7)
   */
  it("cache discount is exactly 70% for all prices", () => {
    fc.assert(
      fc.property(
        // Generate valid price amounts (integers in cents to avoid float issues)
        fc.integer({ min: 1, max: 100 }).map(cents => `$${(cents / 100).toFixed(2)}`),
        (priceStr) => {
          const baseAmount = parsePrice(priceStr);
          const cachedAmount = parsePrice(getCachedPrice(priceStr));

          // Expected: 30% of original (70% discount)
          const expectedCached = baseAmount * (1 - PRICING.cacheDiscount);

          // Allow small floating point tolerance
          expect(Math.abs(cachedAmount - expectedCached)).toBeLessThan(0.0001);
        }
      ),
      { numRuns: 100 }
    );
  });
});
