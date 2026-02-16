/**
 * Property-Based Tests for Intel Pricing Configuration
 *
 * **Feature: Knowledge Arbitrageur, Property: Intel pricing consistency**
 * **Validates: Premium pricing tiers for /intel/* endpoints**
 *
 * For any /intel/* endpoint, the configured price SHALL correctly reflect
 * the premium nature (10-100x higher than base API calls), be a valid
 * USD format, and maintain correct ordering by complexity.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { PRICING, getCachedPrice } from "../../src/config";

// All intel endpoint names and their expected prices
const INTEL_ENDPOINTS = [
    { name: "company", price: PRICING.intel.company },
    { name: "market", price: PRICING.intel.market },
    { name: "competitive", price: PRICING.intel.competitive },
    { name: "siteAudit", price: PRICING.intel.siteAudit },
] as const;

function parsePrice(price: string): number {
    return parseFloat(price.replace("$", ""));
}

describe("Property: Intel pricing consistency", () => {
    /**
     * Property: All intel prices exist and use USD format
     * For any intel endpoint, the price SHALL start with "$" and parse to a positive number
     */
    it("all intel prices are valid USD format strings", () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...INTEL_ENDPOINTS),
                (endpoint) => {
                    expect(endpoint.price).toMatch(/^\$\d+\.\d{2}$/);
                    expect(parsePrice(endpoint.price)).toBeGreaterThan(0);
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * Property: Intel prices are premium (10x+ base API price)
     * For any intel endpoint, the price SHALL be at least 10x the cheapest base API call ($0.005)
     */
    it("all intel prices are at least 10x the cheapest base endpoint", () => {
        const cheapestBasePrice = parsePrice(PRICING.fetch.basic); // $0.005

        fc.assert(
            fc.property(
                fc.constantFrom(...INTEL_ENDPOINTS),
                (endpoint) => {
                    const intelPrice = parsePrice(endpoint.price);
                    expect(intelPrice).toBeGreaterThanOrEqual(cheapestBasePrice * 10);
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * Property: Competitive analysis is the most expensive intel endpoint
     * /intel/competitive ($3.00) > /intel/market ($2.00) > /intel/company ($0.50) > /intel/site-audit ($0.30)
     */
    it("intel pricing follows complexity ordering", () => {
        fc.assert(
            fc.property(
                fc.constant(null),
                () => {
                    const competitive = parsePrice(PRICING.intel.competitive);
                    const market = parsePrice(PRICING.intel.market);
                    const company = parsePrice(PRICING.intel.company);
                    const siteAudit = parsePrice(PRICING.intel.siteAudit);

                    expect(competitive).toBeGreaterThan(market);
                    expect(market).toBeGreaterThan(company);
                    expect(company).toBeGreaterThan(siteAudit);
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * Property: Intel prices are never more than $10
     * For any intel endpoint, the price SHALL be capped at a reasonable maximum
     */
    it("all intel prices are within reasonable bounds ($0.10 - $10.00)", () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...INTEL_ENDPOINTS),
                (endpoint) => {
                    const price = parsePrice(endpoint.price);
                    expect(price).toBeGreaterThanOrEqual(0.1);
                    expect(price).toBeLessThanOrEqual(10.0);
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * Property: Cache discount applies correctly to intel endpoints
     * For any intel price, cached version SHALL be exactly 30% of original (70% discount)
     */
    it("cache discount applies correctly to all intel prices", () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...INTEL_ENDPOINTS),
                (endpoint) => {
                    const baseAmount = parsePrice(endpoint.price);
                    const cachedPriceStr = getCachedPrice(endpoint.price);
                    const cachedAmount = parsePrice(cachedPriceStr);
                    const expectedCached = baseAmount * (1 - PRICING.cacheDiscount);

                    expect(Math.abs(cachedAmount - expectedCached)).toBeLessThan(0.0001);
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * Property: Intel pricing is more expensive than research endpoint
     * For any intel endpoint, its price SHALL exceed the research endpoint price
     */
    it("all intel endpoints cost more than research endpoint", () => {
        const researchPrice = parsePrice(PRICING.research);

        fc.assert(
            fc.property(
                fc.constantFrom(...INTEL_ENDPOINTS),
                (endpoint) => {
                    expect(parsePrice(endpoint.price)).toBeGreaterThan(researchPrice);
                },
            ),
            { numRuns: 100 },
        );
    });
});
