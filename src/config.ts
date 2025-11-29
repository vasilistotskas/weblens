/**
 * WebLens Configuration
 * Pricing, facilitators, and cache settings
 */

// Pricing configuration for all endpoints
export const PRICING = {
  screenshot: "$0.02",
  fetch: {
    basic: "$0.005",
    pro: "$0.015",
  },
  search: "$0.005",
  extract: "$0.02",
  cacheDiscount: 0.7, // 70% off for cached responses
} as const;

// Facilitator URLs for payment verification
export const FACILITATORS = {
  cdp: "https://x402.org/facilitator",
  payai: "https://facilitator.payai.network",
} as const;

// Supported networks and their facilitator mappings
// Requirement 4.1: Multi-chain payment support for Base, Solana, Polygon
export const NETWORKS = {
  "base-sepolia": {
    facilitator: "cdp" as const,
    facilitatorUrl: FACILITATORS.cdp,
    isTestnet: true,
  },
  base: {
    facilitator: "cdp" as const,
    facilitatorUrl: FACILITATORS.cdp,
    isTestnet: false,
  },
  solana: {
    facilitator: "payai" as const,
    facilitatorUrl: FACILITATORS.payai,
    isTestnet: false,
  },
  polygon: {
    facilitator: "payai" as const,
    facilitatorUrl: FACILITATORS.payai,
    isTestnet: false,
  },
} as const;

// List of all supported networks for 402 responses
// Requirement 4.1: 402 response SHALL include payment options for Base, Solana, and Polygon
export const SUPPORTED_NETWORKS = ["base", "base-sepolia", "solana", "polygon"] as const;

// Cache configuration
export const CACHE_CONFIG = {
  defaultTtl: 3600, // 1 hour in seconds
  minTtl: 60, // 1 minute
  maxTtl: 86400, // 24 hours
  keyPrefix: "weblens",
} as const;

// Viewport bounds for screenshots
export const VIEWPORT_BOUNDS = {
  width: { min: 320, max: 3840, default: 1280 },
  height: { min: 240, max: 2160, default: 720 },
} as const;

// Timeout configuration
export const TIMEOUT_CONFIG = {
  default: 10000, // 10 seconds
  min: 5000, // 5 seconds
  max: 30000, // 30 seconds
} as const;

// Calculate cached price (70% discount)
export function getCachedPrice(basePrice: string): string {
  const amount = parseFloat(basePrice.replace("$", ""));
  const cachedAmount = amount * (1 - PRICING.cacheDiscount);
  return `$${cachedAmount.toFixed(4)}`;
}

// Get price for an endpoint
export function getEndpointPrice(
  endpoint: "screenshot" | "fetch-basic" | "fetch-pro" | "search" | "extract",
  cached: boolean = false
): string {
  let basePrice: string;

  switch (endpoint) {
    case "screenshot":
      basePrice = PRICING.screenshot;
      break;
    case "fetch-basic":
      basePrice = PRICING.fetch.basic;
      break;
    case "fetch-pro":
      basePrice = PRICING.fetch.pro;
      break;
    case "search":
      basePrice = PRICING.search;
      break;
    case "extract":
      basePrice = PRICING.extract;
      break;
    default:
      throw new Error(`Unknown endpoint: ${endpoint}`);
  }

  return cached ? getCachedPrice(basePrice) : basePrice;
}

// Type exports for configuration
export type NetworkName = keyof typeof NETWORKS;
export type FacilitatorName = keyof typeof FACILITATORS;
export type EndpointName = "screenshot" | "fetch-basic" | "fetch-pro" | "search" | "extract";
