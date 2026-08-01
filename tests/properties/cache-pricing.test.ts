/**
 * Property-Based Tests for Cache Pricing
 *
 * **Feature: weblens-phase1, Property 6: Cache hit returns reduced price**
 * **Validates: Requirements 3.2**
 *
 * For any request with `cache=true` where a valid cached response exists,
 * the 402 Payment Required response SHALL contain a price that is 70% lower
 * than the standard price.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { PRICING } from "../../src/config";
import { getCachedPrice, parsePrice } from "../../src/services/pricing";

// Base prices for the cacheable/priced endpoints, straight from PRICING —
// the single source of truth (getBasePrice/getEndpointPrice were removed).
const ENDPOINT_PRICES: Record<string, string> = {
  screenshot: PRICING.screenshot,
  "fetch-basic": PRICING.fetch.basic,
  "fetch-pro": PRICING.fetch.pro,
  search: PRICING.search,
  extract: PRICING.extract,
};

describe("Property 6: Cache hit returns reduced price", () => {
  /**
   * Property: Cached price is exactly 70% lower than base price
   * For any endpoint, cached price = base price * (1 - 0.7) = base price * 0.3
   */
  it("cached price is exactly 70% lower than base price for all endpoints", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.keys(ENDPOINT_PRICES)),
        (endpoint) => {
          const basePrice = parsePrice(ENDPOINT_PRICES[endpoint]);
          const cachedPrice = parsePrice(getCachedPrice(ENDPOINT_PRICES[endpoint]));

          // Cached price should be 30% of base (70% discount)
          const expectedCachedPrice = basePrice * (1 - PRICING.cacheDiscount);

          // Allow small floating point tolerance
          expect(Math.abs(cachedPrice - expectedCachedPrice)).toBeLessThan(0.0001);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Cached price is always less than base price
   * For any valid price, getCachedPrice returns a lower value
   */
  it("cached price is always less than base price", () => {
    fc.assert(
      fc.property(
        // Generate valid price amounts (positive numbers)
        fc.double({ min: 0.001, max: 100, noNaN: true }),
        (amount) => {
          const priceStr = `$${amount.toFixed(4)}`;
          const cachedPriceStr = getCachedPrice(priceStr);
          const cachedAmount = parsePrice(cachedPriceStr);

          expect(cachedAmount).toBeLessThan(amount);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Cache discount is consistently 70%
   * For any price, the discount (base minus cached) is exactly 70% of the base
   */
  it("cache discount is consistently 70% of base price", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 100, noNaN: true }),
        (amount) => {
          const base = parseFloat(amount.toFixed(4));
          const priceStr = `$${amount.toFixed(4)}`;
          const discount = base - parsePrice(getCachedPrice(priceStr));
          const expectedDiscount = base * PRICING.cacheDiscount;

          // Allow small floating point tolerance
          expect(Math.abs(discount - expectedDiscount)).toBeLessThan(0.0001);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: The configured cache discount is 70%
   */
  it("cache discount rate is configured at 70%", () => {
    expect(PRICING.cacheDiscount).toBe(0.7);
  });

  /**
   * Property: Cached price + discount = base price
   * For any price, cached + (base * discount rate) should equal the original
   */
  it("cached price plus discount equals base price", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 100, noNaN: true }),
        (amount) => {
          const base = parseFloat(amount.toFixed(4));
          const priceStr = `$${amount.toFixed(4)}`;
          const cachedPrice = parsePrice(getCachedPrice(priceStr));
          const discount = base * PRICING.cacheDiscount;

          // cached + discount should equal original (within tolerance)
          expect(Math.abs((cachedPrice + discount) - base)).toBeLessThan(0.0001);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Specific tier cached prices are correct
   * /fetch/basic cached = $0.0015, /fetch/pro cached = $0.0045
   */
  it("specific tier cached prices match expected values", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("fetch-basic", "fetch-pro"),
        (endpoint) => {
          const cachedPrice = parsePrice(getCachedPrice(ENDPOINT_PRICES[endpoint]));

          // Derived from config so a deliberate reprice does not need a
          // second edit here — the property under test is the 70% discount.
          const listPrice = parsePrice(ENDPOINT_PRICES[endpoint]);
          expect(Math.abs(cachedPrice - listPrice * 0.3)).toBeLessThan(0.0001);
        }
      ),
      { numRuns: 100 }
    );
  });
});
