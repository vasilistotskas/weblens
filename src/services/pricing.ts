/**
 * Pricing Service
 * Consolidated pricing logic: complexity analysis, endpoint pricing,
 * cache discounts, batch pricing, and utility helpers.
 */

import { PRICING } from "../config";

// Complexity multipliers for dynamic pricing
const COMPLEXITY = {
    LOW: 1.0,
    MEDIUM: 1.5,
    HIGH: 3.0,
    VERY_HIGH: 5.0,
};

/**
 * Highest multiplier `getComplexityMultiplier` can return. Discovery surfaces
 * (OpenAPI x-payment-info dynamic ranges) derive their advertised max from
 * this so they can never drift from the actual pricing logic.
 */
export const MAX_COMPLEXITY_MULTIPLIER = COMPLEXITY.HIGH;

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

/** Base price of each complexity-priced endpoint. */
const COMPLEXITY_PRICED_BASE = {
    "fetch-basic": PRICING.fetch.basic,
    "fetch-pro": PRICING.fetch.pro,
    extract: PRICING.extract,
} as const;

export type ComplexityPricedEndpoint = keyof typeof COMPLEXITY_PRICED_BASE;

/**
 * Price a request by the target URL's complexity multiplier.
 * @returns Price string with $ prefix (e.g., "$0.0150")
 */
export function calculatePrice(url: string, type: ComplexityPricedEndpoint): string {
    return formatPrice(parsePrice(COMPLEXITY_PRICED_BASE[type]) * getComplexityMultiplier(url));
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
function formatPrice(amount: number, decimals: number = 4): string {
    return `$${amount.toFixed(decimals)}`;
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
 * Calculate batch fetch price (linear: N URLs x per-URL rate).
 * @returns Price string with $ prefix
 */
export function getBatchFetchPrice(urlCount: number): string {
    const perUrlAmount = parsePrice(PRICING.batchFetch.perUrl);
    const totalAmount = urlCount * perUrlAmount;
    // 4 decimals, like every other resolver: at a sub-$0.001 per-unit price
    // 3 decimals rounds an odd unit count UP (3 x $0.0015 = $0.0045 -> $0.005),
    // which overcharges and breaks linearity. USDC carries 6 decimals.
    return `$${totalAmount.toFixed(4)}`;
}

/**
 * Compute the advertised per-request price range directly from PRICING, so the
 * discovery / MCP / docs surfaces can never drift from config. Excludes the
 * credit deposit tiers and the non-price numeric settings.
 */
export function getPriceRange(): string {
    const prices: number[] = [];
    const collect = (value: unknown): void => {
        if (typeof value === "string" && value.startsWith("$")) {
            prices.push(parsePrice(value));
        } else if (value && typeof value === "object") {
            for (const v of Object.values(value)) { collect(v); }
        }
    };
    for (const [key, value] of Object.entries(PRICING)) {
        // Skip deposit tiers and non-price scalars.
        if (key === "credits" || key === "cacheDiscount") { continue; }
        collect(value);
    }
    const fmt = (n: number) => (n < 0.01 ? n.toFixed(4) : n.toFixed(2));
    return `$${fmt(Math.min(...prices))} - $${fmt(Math.max(...prices))} per request`;
}
