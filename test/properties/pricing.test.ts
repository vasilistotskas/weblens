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
import { PRICING, getEndpointPrice, getCachedPrice } from "../../src/config";

describe("Property 3: Tier pricing consistency", () => {
  /**
   * Property: /fetch/basic always returns $0.005
   * For any request to /fetch/basic, the price SHALL be $0.005
   */
  it("fetch/basic endpoint always returns correct price ($0.005)", () => {
    fc.assert(
      fc.property(
        // Generate arbitrary boolean for cache parameter (doesn't affect base price check)
        fc.boolean(),
        (_cached) => {
          const price = getEndpointPrice("fetch-basic", false);
          expect(price).toBe("$0.005");
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: /fetch/pro always returns $0.015
   * For any request to /fetch/pro, the price SHALL be $0.015
   */
  it("fetch/pro endpoint always returns correct price ($0.015)", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        (_cached) => {
          const price = getEndpointPrice("fetch-pro", false);
          expect(price).toBe("$0.015");
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Tier prices are consistent with PRICING constant
   * For any tiered endpoint, the returned price matches the configured PRICING
   */
  it("tier prices match PRICING configuration", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("fetch-basic", "fetch-pro") as fc.Arbitrary<"fetch-basic" | "fetch-pro">,
        (endpoint) => {
          const price = getEndpointPrice(endpoint, false);
          const expectedPrice = endpoint === "fetch-basic" 
            ? PRICING.fetch.basic 
            : PRICING.fetch.pro;
          expect(price).toBe(expectedPrice);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Basic tier is always cheaper than Pro tier
   * For any comparison, basic price < pro price
   */
  it("basic tier is always cheaper than pro tier", () => {
    fc.assert(
      fc.property(
        fc.constant(null),
        () => {
          const basicPrice = parseFloat(getEndpointPrice("fetch-basic", false).replace("$", ""));
          const proPrice = parseFloat(getEndpointPrice("fetch-pro", false).replace("$", ""));
          expect(basicPrice).toBeLessThan(proPrice);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Cached prices are always lower than base prices
   * For any endpoint, getCachedPrice returns a lower price
   */
  it("cached prices are always lower than base prices for all endpoints", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("screenshot", "fetch-basic", "fetch-pro", "search", "extract") as fc.Arbitrary<"screenshot" | "fetch-basic" | "fetch-pro" | "search" | "extract">,
        (endpoint) => {
          const basePrice = parseFloat(getEndpointPrice(endpoint, false).replace("$", ""));
          const cachedPrice = parseFloat(getEndpointPrice(endpoint, true).replace("$", ""));
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
          const baseAmount = parseFloat(priceStr.replace("$", ""));
          const cachedPriceStr = getCachedPrice(priceStr);
          const cachedAmount = parseFloat(cachedPriceStr.replace("$", ""));
          
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
