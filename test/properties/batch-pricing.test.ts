/**
 * Property-Based Tests for Batch Fetch Pricing
 * 
 * **Feature: weblens, Property 2: Batch fetch pricing is linear**
 * **Validates: Requirements 1.4**
 * 
 * For any batch fetch request with N URLs, the total price SHALL equal N × $0.003.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { PRICING, getBatchFetchPrice } from "../../src/config";

describe("Property 2: Batch fetch pricing is linear", () => {
  /**
   * Property: Total price equals N × $0.003
   * For any batch fetch request with N URLs (2 ≤ N ≤ 20), 
   * the total price SHALL equal N × $0.003
   */
  it("batch fetch price equals urlCount × $0.003 for valid URL counts", () => {
    fc.assert(
      fc.property(
        // Generate URL counts within valid bounds (2-20)
        fc.integer({ min: PRICING.batchFetch.minUrls, max: PRICING.batchFetch.maxUrls }),
        (urlCount) => {
          const price = getBatchFetchPrice(urlCount);
          const perUrlAmount = parseFloat(PRICING.batchFetch.perUrl.replace("$", ""));
          const expectedAmount = urlCount * perUrlAmount;
          const expectedPrice = `$${expectedAmount.toFixed(3)}`;
          
          expect(price).toBe(expectedPrice);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Pricing is strictly linear (doubling URLs doubles price)
   * For any URL count N, price(2N) = 2 × price(N)
   */
  it("doubling URL count doubles the price", () => {
    fc.assert(
      fc.property(
        // Generate URL counts where doubling stays within bounds
        fc.integer({ min: 2, max: 10 }),
        (urlCount) => {
          const singlePrice = parseFloat(getBatchFetchPrice(urlCount).replace("$", ""));
          const doublePrice = parseFloat(getBatchFetchPrice(urlCount * 2).replace("$", ""));
          
          // Allow small floating point tolerance
          expect(Math.abs(doublePrice - (singlePrice * 2))).toBeLessThan(0.0001);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Price increases monotonically with URL count
   * For any N < M, price(N) < price(M)
   */
  it("price increases monotonically with URL count", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 19 }),
        (urlCount) => {
          const priceN = parseFloat(getBatchFetchPrice(urlCount).replace("$", ""));
          const priceNPlus1 = parseFloat(getBatchFetchPrice(urlCount + 1).replace("$", ""));
          
          expect(priceNPlus1).toBeGreaterThan(priceN);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Price per URL is constant
   * For any URL count N, price(N) / N = $0.003
   */
  it("price per URL is constant at $0.003", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 20 }),
        (urlCount) => {
          const totalPrice = parseFloat(getBatchFetchPrice(urlCount).replace("$", ""));
          const pricePerUrl = totalPrice / urlCount;
          const expectedPerUrl = parseFloat(PRICING.batchFetch.perUrl.replace("$", ""));
          
          // Allow small floating point tolerance
          expect(Math.abs(pricePerUrl - expectedPerUrl)).toBeLessThan(0.0001);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Minimum batch (2 URLs) has correct price
   * price(2) = $0.006
   */
  it("minimum batch of 2 URLs costs $0.006", () => {
    const price = getBatchFetchPrice(2);
    expect(price).toBe("$0.006");
  });

  /**
   * Property: Maximum batch (20 URLs) has correct price
   * price(20) = $0.060
   */
  it("maximum batch of 20 URLs costs $0.060", () => {
    const price = getBatchFetchPrice(20);
    expect(price).toBe("$0.060");
  });
});
