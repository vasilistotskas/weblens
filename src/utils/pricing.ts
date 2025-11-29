/**
 * Pricing Utility Functions
 * Calculate prices for endpoints with cache discount support
 * 
 * Requirements: 3.2
 */

import { PRICING, type EndpointName } from "../config";

/**
 * Calculate the cached price (70% discount from base price)
 * 
 * @param basePrice - The base price string (e.g., "$0.02" or "0.02")
 * @returns The discounted price as a string without $ prefix
 */
export function getCachedPrice(basePrice: string): string {
  const amount = parseFloat(basePrice.replace("$", ""));
  const cachedAmount = amount * (1 - PRICING.cacheDiscount);
  return `${cachedAmount.toFixed(4)}`;
}

/**
 * Get the base price for an endpoint
 * 
 * @param endpoint - The endpoint name
 * @returns The base price string with $ prefix
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
 * Get the price for an endpoint, optionally with cache discount
 * 
 * @param endpoint - The endpoint name
 * @param cached - Whether to apply cache discount
 * @returns The price string (with $ prefix for base, without for cached)
 */
export function getEndpointPrice(endpoint: EndpointName, cached: boolean = false): string {
  const basePrice = getBasePrice(endpoint);
  return cached ? getCachedPrice(basePrice) : basePrice;
}

/**
 * Calculate the discount amount for a cached response
 * 
 * @param basePrice - The base price string
 * @returns The discount amount as a number
 */
export function getDiscountAmount(basePrice: string): number {
  const amount = parseFloat(basePrice.replace("$", ""));
  return amount * PRICING.cacheDiscount;
}

/**
 * Get the cache discount percentage
 * 
 * @returns The discount percentage (0-100)
 */
export function getCacheDiscountPercentage(): number {
  return PRICING.cacheDiscount * 100;
}

/**
 * Format a price amount as a string with $ prefix
 * 
 * @param amount - The price amount as a number
 * @param decimals - Number of decimal places (default 4)
 * @returns Formatted price string with $ prefix
 */
export function formatPrice(amount: number, decimals: number = 4): string {
  return `$${amount.toFixed(decimals)}`;
}

/**
 * Parse a price string to a number
 * 
 * @param price - The price string (with or without $ prefix)
 * @returns The price as a number
 */
export function parsePrice(price: string): number {
  return parseFloat(price.replace("$", ""));
}
