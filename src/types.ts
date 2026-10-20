/**
 * WebLens Type Definitions
 * All request/response interfaces for the API
 */

import type { CreditAccountDO } from "./durable_objects/CreditAccountDO";
import type { FacilitatorLabel } from "./services/payment-telemetry";
import type { Logger } from "./utils/logger";

// Environment bindings for Cloudflare Workers
export interface Env {
  PAY_TO_ADDRESS: string;
  /**
   * Solana payout address. Optional: setting it turns on a second `accepts`
   * entry so buyers can pay on Solana as well as Base. It must be an address
   * whose USDC associated token account already exists — see svmNetwork() in
   * config.ts. Unset means Solana is not advertised at all.
   */
  PAY_TO_ADDRESS_SVM?: string;
  // CDP API keys - REQUIRED for payment verification and Bazaar discovery
  // The @coinbase/x402 facilitator reads these automatically
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
  // Network configuration
  FACILITATOR_URL?: string;
  NETWORK?: string;
  // Cloudflare services
  BROWSER?: Fetcher; // Cloudflare Browser Rendering
  CACHE?: KVNamespace; // Cloudflare KV for caching
  ACCOUNTS: DurableObjectNamespace<CreditAccountDO>; // Prepaid accounts, one Durable Object each
  BILLING_LIMITER: RateLimit; // Workers Rate Limiting for /billing/checkout and key rotation
  PAYMENT_EVENTS: AnalyticsEngineDataset; // Payment funnel events (services/payment-telemetry.ts)
  // Optional API keys
  SERP_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  // Structured-log verbosity (debug|info|warn|error|silent); default info.
  LOG_LEVEL?: string;
  // Facilitator URL override (PayAI fallback for multi-chain support)
  PAYAI_FACILITATOR_URL?: string;
  // PayAI facilitator API key (services/payai-auth.ts). Without it PayAI
  // settles only within a free allowance counted per payout wallet (and drawn
  // from a shared pool for requests from cloud IPs); beyond that, settles are
  // paid from the key's prepaid credits. Both halves or neither: PayAI
  // rejects a bad credential instead of falling back to anonymous access.
  // Set via: wrangler secret put PAYAI_API_KEY_ID / PAYAI_API_KEY_SECRET
  PAYAI_API_KEY_ID?: string;
  PAYAI_API_KEY_SECRET?: string;
  // Facilitators each network family settles through, in the order they are
  // tried, comma-separated (cdp | payai | x402.org). Required; a Solana list
  // holds exactly one (see services/facilitator-chain.ts).
  FACILITATORS_EVM?: string;
  FACILITATORS_SVM?: string;
  // API key prefix of this environment ("wl_live_" in production, "wl_test_"
  // on testnet), so a key only ever works where it was sold.
  API_KEY_PREFIX: string;
  // Stripe Checkout with Managed Payments for prepaid packs (services/stripe.ts).
  // Without both, /billing/* answers 503. The secret key's mode (sk_test_ /
  // sk_live_) must match API_KEY_PREFIX.
  // Set via: wrangler secret put STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /**
   * Optional secondary webhook secret to support Stripe's zero-downtime
   * secret rotation (Stripe exposes two active secrets during rotation).
   * If set, webhooks signed with either primary or secondary secret verify.
   */
  STRIPE_WEBHOOK_SECRET_2?: string;
}

/** The Hono environment every route and middleware runs in. */
export interface AppEnv {
  Bindings: Env;
  Variables: Variables;
}

export interface Variables {
  requestId: string;
  validatedBody?: unknown;
  paidWithCredits?: boolean;
  startTime?: number;
}

// Augment Hono ContextVariableMap so c.get()/c.set() are typed
declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
    validatedBody: unknown;
    paidWithCredits: boolean;
    startTime: number;
    // Response caching (set by cacheLookupMiddleware, read by the credit/x402
    // price functions and cacheServeMiddleware). See src/middleware/cache.ts.
    cacheEnabled: boolean;
    cacheKey: string;
    cacheTtl: number;
    cacheHit: boolean;
    cachedBody: unknown;
    // Request-scoped structured logger (set by requestId middleware).
    log: Logger;
  }
}

// ============================================
// Screenshot Types (Requirement 1)
// ============================================

export interface ScreenshotRequest {
  url: string;
  viewport?: {
    width: number; // 320-3840, default 1280
    height: number; // 240-2160, default 720
  };
  selector?: string; // CSS selector for element capture
  fullPage?: boolean; // Capture entire scrollable page
  timeout?: number; // 5000-30000ms, default 10000
}

export interface ScreenshotResponse {
  url: string;
  image: string; // Base64-encoded PNG
  dimensions: {
    width: number;
    height: number;
  };
  capturedAt: string; // ISO timestamp
  requestId: string;
}

// ============================================
// Fetch Types (Requirement 2)
// ============================================

interface PageMetadata {
  description?: string;
  author?: string;
  publishedAt?: string;
}

export interface FetchResponse {
  url: string;
  title: string;
  content: string; // Markdown
  metadata: PageMetadata;
  tier: "basic" | "pro";
  fetchedAt: string; // ISO timestamp
  requestId: string;
}

// ============================================
// Search Types
// ============================================

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  position: number;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  searchedAt: string;
  requestId: string;
}

// ============================================
// Extract Types
// ============================================

export interface ExtractResponse {
  url: string;
  data: Record<string, unknown>;
  extractedAt: string;
  requestId: string;
}

// ============================================
// Error Types (Requirement 5.4)
// ============================================

export type ErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_URL"
  | "INVALID_VIEWPORT"
  | "INVALID_TTL"
  | "INVALID_SELECTOR"
  | "FETCH_TIMEOUT"
  | "RENDER_FAILED"
  | "ELEMENT_NOT_FOUND"
  | "CACHE_ERROR"
  | "PAYMENT_FAILED"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR"
  | "BATCH_TOO_SMALL"
  | "BATCH_TOO_LARGE"
  | "INVALID_PDF"
  | "PDF_TOO_LARGE"
  | "EXTRACTION_FAILED"
  | "RESEARCH_FAILED"
  | "AI_UNAVAILABLE"
  | "UNSUPPORTED_CONTENT" // Target served binary / non-text content (422)
  // --- Validation middleware (src/middleware/validation.ts) ---
  | "VALIDATION_ERROR" // Zod schema validation failed (400)
  | "INVALID_CONTENT_TYPE" // Non-JSON Content-Type on POST/PUT (400)
  | "INVALID_JSON" // Body was not parseable JSON (400)
  | "PAYLOAD_TOO_LARGE" // Body exceeds 256KB cap (413)
  // --- Prepaid API keys (middleware/api-key.ts, routes/billing.ts) ---
  | "INVALID_API_KEY" // Authorization is not an active key of this environment (401)
  | "INSUFFICIENT_CREDITS" // The key's account holds less than the call costs (402)
  // --- Routing (src/middleware/routing.ts) ---
  | "METHOD_NOT_ALLOWED" // Path exists, but not under this method (405)
  | "UNSUBSTITUTED_PATH_TEMPLATE" // Path still contains a documented {placeholder} (400)
  | "NOT_FOUND" // Unknown route (404)
  // --- Crawl (tools/crawl.ts) ---
  | "FORBIDDEN" // robots.txt disallows crawling the requested URL (403)
  // --- Free-tier reader (tools/reader.ts) ---
  | "MISSING_URL" // Reader called without a URL (400)
  | "REDIRECT_BLOCKED" // Reader hit a blocked redirect target (400)
  // --- Tech detection (tools/tech.ts) ---
  | "FETCH_FAILED" // The target page could not be fetched (502)
  // --- Resilient fetch (tools/resilient-fetch.ts) ---
  | "FETCH_ALL_PROVIDERS_FAILED" // Every fetch provider failed (502)
  // --- Project due diligence (tools/project-audit.ts) ---
  | "INTEL_FAILED" // Due-diligence workflow failed (500)
  // --- Discussions endpoint (tools/discussions.ts) ---
  | "PROVIDER_ERROR"; // Upstream discussion index returned an error (502)

export interface ErrorResponse {
  error: string;
  code: ErrorCode;
  message: string;
  requestId: string;
  retryAfter?: number; // seconds
}

// ============================================
// Health Check Types (Requirement 5.2)
// ============================================

export interface ServiceStatus {
  status: "healthy" | "unhealthy" | "degraded";
  latency?: number; // ms
  error?: string;
}

export interface HealthResponse {
  status: "healthy" | "unhealthy" | "degraded";
  version: string;
  timestamp: string;
  services: {
    cache: ServiceStatus;
    browserRendering: ServiceStatus;
    /** Every facilitator this deployment settles through, keyed by name. */
    facilitators: Partial<Record<FacilitatorLabel, ServiceStatus>>;
  };
}

// ============================================
// URL Validation Types
// ============================================

export interface URLValidationResult {
  valid: boolean;
  normalized?: string;
  error?: string;
}

// ============================================
// PDF Extraction Types (Requirement 5)
// ============================================

export interface PdfPage {
  pageNumber: number;
  content: string;
}

export interface PdfExtractResponse {
  url: string;
  metadata: {
    title?: string;
    author?: string;
    pageCount: number;
    createdAt?: string;
  };
  pages: PdfPage[];
  fullText: string;         // All pages concatenated
  extractedAt: string;
  requestId: string;
}

// ============================================
// Free Tier Types
// ============================================

export interface FreeTierMetadata {
  tier: "free";
  limits: {
    contentLength: number;
    requestsPerHour: number;
  };
  remainingRequests: number;
  upgradeUrl: string;
  message: string;
}

