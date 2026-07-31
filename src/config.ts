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
  // Search pricing floor: every SerpAPI-backed call costs $0.009-$0.015
  // upstream depending on plan tier — prices below $0.015 would sell at a
  // loss on the worst-case plan rate.
  search: "$0.015",
  searchVerticals: {
    news: "$0.015",
    images: "$0.015",
    places: "$0.045",   // market anchor: StableEnrich sells Maps-backed places at $0.045
    shopping: "$0.015",
    scholar: "$0.015",
    autocomplete: "$0.015",
    trends: "$0.015",
  },
  // Per-result page-content addon for search (includeContent) and the
  // standalone /contents endpoint. Native fetch has ~zero marginal cost.
  contents: {
    perUrl: "$0.002",
    minUrls: 1,
    maxUrls: 20,
  },
  youtubeTranscript: "$0.03", // 1 SerpAPI call upstream; StableSocial sells transcripts at $0.06
  answer: "$0.05", // ~$0.026 worst-case upstream (1 SerpAPI call + capped Haiku tokens)
  extract: "$0.03",
  cacheDiscount: 0.7, // 70% off for cached responses

  // Batch fetch pricing
  batchFetch: {
    perUrl: "$0.003",
    minUrls: 2,
    maxUrls: 20,
  },

  // Site URL discovery (sitemap/robots/link based). A handful of subrequests
  // regardless of site size, so a flat price stays profitable.
  map: "$0.01",

  // Bounded whole-site crawl. Priced per requested page (the page budget the
  // caller reserves), consistent with batch fetch. Native fetch + markdown,
  // so marginal cost is CPU only.
  crawl: {
    perPage: "$0.003",
    minPages: 1,
    maxPages: 25,
  },

  // Research endpoint
  research: "$0.08",

  // Multi-step deep research (plan -> search per sub-question -> fetch ->
  // cited synthesis). Worst-case upstream cost per tier, at SerpAPI's
  // $0.015/search ceiling and Haiku 4.5 at $1/$5 per MTok:
  //   standard: 3 searches ($0.045) + ~$0.02 AI = ~$0.065  -> $0.20 (3x)
  //   deep:     5 searches ($0.075) + ~$0.03 AI = ~$0.105  -> $0.35 (3.3x)
  // Changing DEEP_RESEARCH_TIERS in services/deep-research.ts changes those
  // ceilings — reprice here if you do.
  deepResearch: {
    standard: "$0.20",
    deep: "$0.35",
  },

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

  // Agent Credit Accounts (Clearing House seed)
  credits: {
    tiers: [
      { minDeposit: "$10", bonus: 0.20 },   // 20% bonus
      { minDeposit: "$50", bonus: 0.30 },   // 30% bonus
      { minDeposit: "$100", bonus: 0.40 },  // 40% bonus
    ],
  },
} as const;

// Paid POST endpoints. Used by the POST-only enforcement middleware
// (src/index.ts) and by request validation: unauthenticated probes of these
// paths fall through to the x402 402 challenge instead of a 400, so agents
// that probe without reading the spec still discover a payable resource.
export const PAID_ENDPOINTS: readonly string[] = [
  "/fetch/basic", "/fetch/pro", "/fetch/resilient", "/screenshot", "/search", "/extract",
  "/batch/fetch", "/research", "/extract/smart", "/pdf", "/compare",
  "/monitor/create", "/memory/set", "/credits/buy",
  "/intel/company", "/intel/market", "/intel/competitive", "/intel/site-audit",
  "/search/news", "/search/images", "/search/places", "/search/shopping",
  "/search/scholar", "/search/autocomplete", "/search/trends",
  "/social/youtube/transcript", "/contents", "/answer",
  "/map", "/crawl", "/research/deep",
];

// Free tier configuration - rate-limited access without payment
export const FREE_TIER = {
  // Rate limiting
  maxRequestsPerHour: 10,
  rateLimitWindowSeconds: 3600, // 1 hour
  kvKeyPrefix: "ratelimit",

  // Content limits
  fetchMaxContentLength: 2000, // chars
  searchMaxResults: 3,
} as const;

// List of all supported networks for 402 responses.
// Facilitator selection is NOT configured here — it happens at runtime in
// src/middleware/payment.ts based on env vars (NETWORK, CDP_API_KEY_ID,
// CDP_API_KEY_SECRET, FACILITATOR_URL, PAYAI_FACILITATOR_URL). See
// getResourceServer() in payment.ts for the full branch logic.
export const SUPPORTED_NETWORKS = ["base"] as const;

// Crawl/map execution bounds. Workers on paid plans allow 10k subrequests per
// invocation and bill CPU (not network wait), so these are set for predictable
// latency rather than platform headroom.
export const CRAWL_LIMITS = {
  concurrency: 5,       // simultaneous page fetches per batch
  maxQueued: 500,       // cap on the discovered-URL frontier
  // Sitemap documents fetched per /map call. Real sites nest: both
  // developers.cloudflare.com and x402.org serve a sitemap *index* whose
  // children must be fetched, so this needs headroom above the index itself.
  maxSitemapDocs: 10,
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
