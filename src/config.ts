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
    resilient: "$0.025", // Multi-provider fallback (Agent Prime)
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

  // Intelligence endpoints (Knowledge Arbitrageur)
  // Premium pricing — chains multiple tools + AI into structured intelligence.
  // Still 50–100× cheaper than Semrush/Similarweb/Crunchbase APIs.
  intel: {
    company: "$1.00",       // Company deep dive
    market: "$5.00",        // Market research report
    competitive: "$8.00",   // Competitive analysis
    siteAudit: "$0.75",     // Full site audit
  },

  // Agent Prime: multi-provider routing
  providerMargin: 0.15, // 15% margin on proxied requests

  // Agent Credit Accounts (Clearing House seed)
  credits: {
    tiers: [
      { minDeposit: "$10", bonus: 0.20 },   // 20% bonus
      { minDeposit: "$50", bonus: 0.30 },   // 30% bonus
      { minDeposit: "$100", bonus: 0.40 },  // 40% bonus
    ],
  },
} as const;

// Free tier configuration - rate-limited access without payment
export const FREE_TIER = {
  // Rate limiting
  maxRequestsPerHour: 10,
  rateLimitWindowSeconds: 3600, // 1 hour
  kvKeyPrefix: "ratelimit",

  // Content limits
  fetchMaxContentLength: 2000, // chars
  searchMaxResults: 3,

  // Available free endpoints
  endpoints: ["/free/fetch", "/free/search"] as readonly string[],
} as const;

// List of all supported networks for 402 responses.
// Facilitator selection is NOT configured here — it happens at runtime in
// src/middleware/payment.ts based on env vars (NETWORK, CDP_API_KEY_ID,
// CDP_API_KEY_SECRET, FACILITATOR_URL, PAYAI_FACILITATOR_URL). See
// getResourceServer() in payment.ts for the full branch logic.
export const SUPPORTED_NETWORKS = ["base"] as const;

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

// Type exports for configuration
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
  | "memory-write"
  | "intel-company"
  | "intel-market"
  | "intel-competitive"
  | "intel-site-audit"
  | "fetch-resilient"
  | "credits-buy"
  | "credits-balance";
