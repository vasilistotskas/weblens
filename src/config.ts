/**
 * WebLens Configuration
 * Pricing, facilitators, and cache settings
 */

// Unified pricing configuration for all endpoints
// Requirements: 1.4, 2.6, 3.5, 4.2, 4.4, 5.4, 6.4, 7.2
export const PRICING = {
  // Core endpoints
  screenshot: "$0.02",
  fetch: {
    basic: "$0.005",
    pro: "$0.015",
  },
  search: "$0.005",
  extract: "$0.03",
  cacheDiscount: 0.7, // 70% off for cached responses
  
  // Batch fetch pricing
  batchFetch: {
    perUrl: "$0.003",
    minUrls: 2,
    maxUrls: 20,
  },
  
  // Research endpoint
  research: "$0.08",
  
  // Smart extraction (AI-powered, higher cost)
  smartExtract: "$0.035",
  
  // URL monitoring
  monitor: {
    setup: "$0.01",
    perCheck: "$0.001",
    minInterval: 1,   // hours
    maxInterval: 24,  // hours
  },
  
  // PDF extraction
  pdf: "$0.01",
  
  // URL comparison
  compare: "$0.05",
  
  // Agent memory storage
  memory: {
    write: "$0.001",
    read: "$0.0005",
    minTtl: 1,        // hours
    maxTtl: 720,      // 30 days
    defaultTtl: 168,  // 7 days
  },
} as const;

// Facilitator URLs for payment verification
// Note: x402.org/facilitator is TESTNET ONLY
// For production, use the CDP facilitator object from @coinbase/x402 or PayAI URL
export const FACILITATORS = {
  // PayAI supports Base mainnet, Solana, Polygon, and more
  payai: "https://facilitator.payai.network",
  // Testnet facilitator (for development only)
  testnet: "https://x402.org/facilitator",
} as const;

// Supported networks and their facilitator mappings
// Requirement 4.1: Multi-chain payment support for Base, Solana, Polygon
// Note: For Base networks, use the CDP facilitator object from @coinbase/x402 in code
export const NETWORKS = {
  "base-sepolia": {
    facilitator: "testnet" as const,
    facilitatorUrl: FACILITATORS.testnet,
    isTestnet: true,
  },
  base: {
    facilitator: "payai" as const,
    facilitatorUrl: FACILITATORS.payai,
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
export const SUPPORTED_NETWORKS = ["base"] as const;

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
    default: {
      const _exhaustiveCheck: never = endpoint;
      throw new Error(`Unknown endpoint: ${String(_exhaustiveCheck)}`);
    }
  }

  return cached ? getCachedPrice(basePrice) : basePrice;
}

// Calculate batch fetch price (linear pricing: N URLs × $0.003)
// Requirement 1.4: Batch fetch SHALL charge $0.003 per URL
export function getBatchFetchPrice(urlCount: number): string {
  const perUrlAmount = parseFloat(PRICING.batchFetch.perUrl.replace("$", ""));
  const totalAmount = urlCount * perUrlAmount;
  return `$${totalAmount.toFixed(3)}`;
}

// Type exports for configuration
export type NetworkName = keyof typeof NETWORKS;
export type FacilitatorName = keyof typeof FACILITATORS;
export type EndpointName = 
  | "screenshot" 
  | "fetch-basic" 
  | "fetch-pro" 
  | "search" 
  | "extract"
  | "batch-fetch" 
  | "research" 
  | "smart-extract" 
  | "monitor" 
  | "pdf" 
  | "compare" 
  | "memory-read" 
  | "memory-write";
