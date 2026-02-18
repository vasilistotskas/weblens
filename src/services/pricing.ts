/**
 * Pricing Service
 * Consolidated pricing logic: complexity analysis, endpoint pricing,
 * cache discounts, batch pricing, and utility helpers.
 */

import type { EndpointName } from "../config";
import { PRICING } from "../config";

// Complexity multipliers for dynamic pricing
const COMPLEXITY = {
    LOW: 1.0,
    MEDIUM: 1.5,
    HIGH: 3.0,
    VERY_HIGH: 5.0,
};

// Known high-complexity domains (SPAs, bot protections, etc.)
const HIGH_COMPLEXITY_DOMAINS = [
    "twitter.com",
    "x.com",
    "facebook.com",
    "linkedin.com",
    "instagram.com",
    "tiktok.com",
    "reddit.com",
    "amazon.com",
    "booking.com",
    "airbnb.com",
];

/**
 * Analyze URL complexity to determine pricing multiplier.
 * HIGH_COMPLEXITY_DOMAINS get 3.0x, deep paths/many params get 1.5x.
 */
export function getComplexityMultiplier(url: string): number {
    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.toLowerCase();

        if (HIGH_COMPLEXITY_DOMAINS.some(domain => hostname.includes(domain))) {
            return COMPLEXITY.HIGH;
        }

        const pathDepth = urlObj.pathname.split("/").filter(Boolean).length;
        const queryParamCount = Array.from(urlObj.searchParams.keys()).length;

        if (pathDepth > 3 || queryParamCount > 2) {
            return COMPLEXITY.MEDIUM;
        }

        return COMPLEXITY.LOW;
    } catch {
        return COMPLEXITY.MEDIUM;
    }
}

/**
 * Calculate dynamic price for a request with complexity multiplier and optional discount.
 * @returns Price string with $ prefix (e.g., "$0.0150")
 */
export async function calculatePrice(
    url: string,
    type: "fetch-basic" | "fetch-pro" | "extract",
    discount: number = 0
): Promise<string> {
    let basePriceStr: string;

    switch (type) {
        case "fetch-basic":
            basePriceStr = PRICING.fetch.basic;
            break;
        case "fetch-pro":
            basePriceStr = PRICING.fetch.pro;
            break;
        case "extract":
            basePriceStr = PRICING.extract;
            break;
        default:
            basePriceStr = "$0.01";
    }

    const basePrice = parsePrice(basePriceStr);
    const multiplier = getComplexityMultiplier(url);
    let finalPrice = basePrice * multiplier;

    if (discount > 0 && discount <= 1) {
        finalPrice = finalPrice * (1 - discount);
    }

    return Promise.resolve(formatPrice(finalPrice));
}

/**
 * Parse a price string to a number, stripping the optional $ prefix.
 */
export function parsePrice(price: string): number {
    return parseFloat(price.replace("$", ""));
}

/**
 * Format a numeric price amount as a string with $ prefix.
 * @param decimals Number of decimal places (default 4 for USDC micro-payments)
 */
export function formatPrice(amount: number, decimals: number = 4): string {
    return `$${amount.toFixed(decimals)}`;
}

/**
 * Get the base price for an endpoint from PRICING config.
 * @returns Price string with $ prefix
 */
export function getBasePrice(endpoint: EndpointName): string {
    switch (endpoint) {
        case "screenshot":
            return PRICING.screenshot;
        case "fetch-basic":
            return PRICING.fetch.basic;
        case "fetch-pro":
            return PRICING.fetch.pro;
        case "search":
            return PRICING.search;
        case "extract":
            return PRICING.extract;
        default:
            throw new Error(`Unknown endpoint: ${endpoint}`);
    }
}

/**
 * Calculate the cached price (70% discount from base price).
 * @returns Price string with $ prefix
 */
export function getCachedPrice(basePrice: string): string {
    const amount = parsePrice(basePrice);
    const cachedAmount = amount * (1 - PRICING.cacheDiscount);
    return `$${cachedAmount.toFixed(4)}`;
}

/**
 * Get the price for an endpoint, optionally with cache discount.
 * @returns Price string with $ prefix
 */
export function getEndpointPrice(endpoint: EndpointName, cached: boolean = false): string {
    const basePrice = getBasePrice(endpoint);
    return cached ? getCachedPrice(basePrice) : basePrice;
}

/**
 * Calculate batch fetch price (linear: N URLs x per-URL rate).
 * @returns Price string with $ prefix
 */
export function getBatchFetchPrice(urlCount: number): string {
    const perUrlAmount = parsePrice(PRICING.batchFetch.perUrl);
    const totalAmount = urlCount * perUrlAmount;
    return `$${totalAmount.toFixed(3)}`;
}

/**
 * Calculate the discount amount for a cached response.
 */
export function getDiscountAmount(basePrice: string): number {
    const amount = parsePrice(basePrice);
    return amount * PRICING.cacheDiscount;
}

/**
 * Get the cache discount percentage (0-100).
 */
export function getCacheDiscountPercentage(): number {
    return PRICING.cacheDiscount * 100;
}
