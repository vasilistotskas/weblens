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
import {
  getCachedPrice,
  getBasePrice,
  getEndpointPrice,
  getDiscountAmount,
  getCacheDiscountPercentage,
  parsePrice
} from "../../src/services/pricing";

describe("Property 6: Cache hit returns reduced price", () => {
  /**
   * Property: Cached price is exactly 70% lower than base price
   * For any endpoint, cached price = base price * (1 - 0.7) = base price * 0.3
   */
  it("cached price is exactly 70% lower than base price for all endpoints", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("screenshot", "fetch-basic", "fetch-pro", "search", "extract") as fc.Arbitrary<"screenshot" | "fetch-basic" | "fetch-pro" | "search" | "extract">,
        (endpoint) => {
          const basePrice = parsePrice(getBasePrice(endpoint));
          const cachedPrice = parsePrice(getEndpointPrice(endpoint, true));
          
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
   * For any price, the discount amount is exactly 70% of the base
   */
  it("cache discount is consistently 70% of base price", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 100, noNaN: true }),
        (amount) => {
          const priceStr = `$${amount.toFixed(4)}`;
          const discount = getDiscountAmount(priceStr);
          const expectedDiscount = amount * PRICING.cacheDiscount;
          
          // Allow small floating point tolerance
          expect(Math.abs(discount - expectedDiscount)).toBeLessThan(0.0001);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: getCacheDiscountPercentage returns 70
   * The discount percentage should always be 70%
   */
  it("cache discount percentage is always 70%", () => {
    fc.assert(
      fc.property(
        fc.constant(null),
        () => {
          expect(getCacheDiscountPercentage()).toBe(70);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Cached price + discount = base price
   * For any price, cached + discount should equal the original
   */
  it("cached price plus discount equals base price", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 100, noNaN: true }),
        (amount) => {
          const priceStr = `$${amount.toFixed(4)}`;
          const cachedPrice = parsePrice(getCachedPrice(priceStr));
          const discount = getDiscountAmount(priceStr);
          
          // cached + discount should equal original (within tolerance)
          expect(Math.abs((cachedPrice + discount) - amount)).toBeLessThan(0.0001);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: getEndpointPrice with cached=false returns base price
   * For any endpoint, non-cached price equals base price
   */
  it("non-cached endpoint price equals base price", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("screenshot", "fetch-basic", "fetch-pro", "search", "extract") as fc.Arbitrary<"screenshot" | "fetch-basic" | "fetch-pro" | "search" | "extract">,
        (endpoint) => {
          const basePrice = getBasePrice(endpoint);
          const endpointPrice = getEndpointPrice(endpoint, false);
          
          expect(endpointPrice).toBe(basePrice);
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
        fc.constantFrom("fetch-basic", "fetch-pro") as fc.Arbitrary<"fetch-basic" | "fetch-pro">,
        (endpoint) => {
          const cachedPrice = parsePrice(getEndpointPrice(endpoint, true));
          
          if (endpoint === "fetch-basic") {
            // $0.005 * 0.3 = $0.0015
            expect(Math.abs(cachedPrice - 0.0015)).toBeLessThan(0.0001);
          } else {
            // $0.015 * 0.3 = $0.0045
            expect(Math.abs(cachedPrice - 0.0045)).toBeLessThan(0.0001);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
