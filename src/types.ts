/**
 * WebLens Type Definitions
 * All request/response interfaces for the API
 */

// Environment bindings for Cloudflare Workers
export interface Env {
  WALLET_ADDRESS: string;
  FACILITATOR_URL?: string;
  NETWORK?: string;
  BROWSER?: Fetcher; // Cloudflare Browser Rendering
  CACHE?: KVNamespace; // Cloudflare KV for caching
  SERP_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  CDP_FACILITATOR_URL?: string;
  PAYAI_FACILITATOR_URL?: string;
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

export interface FetchRequest {
  url: string;
  timeout?: number; // ms
  cache?: boolean;
  cacheTtl?: number; // seconds, 60-86400
  waitFor?: string; // CSS selector to wait for (pro only)
}

export interface PageMetadata {
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
  cache?: CacheMetadata;
  requestId: string;
}

// ============================================
// Cache Types (Requirement 3)
// ============================================

export interface CacheMetadata {
  hit: boolean;
  age?: number; // Seconds since cached
  expiresAt?: string; // ISO timestamp
  key?: string;
}

export interface CachedResponse<T = unknown> {
  data: T;
  cachedAt: string; // ISO timestamp
  ttl: number; // seconds
}

// ============================================
// Search Types
// ============================================

export interface SearchRequest {
  query: string;
  limit?: number; // default 10
}

export interface SearchResult {
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

export interface ExtractRequest {
  url: string;
  schema: Record<string, unknown>; // JSON schema for extraction
  instructions?: string; // Natural language instructions
}

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
  | "INTERNAL_ERROR";

export interface ErrorResponse {
  error: string;
  code: ErrorCode;
  message: string;
  requestId: string;
  retryAfter?: number; // seconds
}

// ============================================
// Response Headers (Requirement 5.3)
// ============================================

export interface ResponseHeaders {
  "X-Request-Id": string;
  "X-Processing-Time": string; // milliseconds
  "X-Cache-Status"?: "HIT" | "MISS" | "BYPASS";
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
    facilitators: {
      cdp: ServiceStatus;
      payai: ServiceStatus;
    };
  };
}

// ============================================
// Payment Types (Requirement 4)
// ============================================

export type SupportedNetwork = "base" | "base-sepolia" | "solana" | "polygon";

export interface PaymentOption {
  scheme: string;
  network: SupportedNetwork;
  maxAmountRequired: string;
  resource: string;
  payTo: string;
  asset: string;
}

export interface PaymentRequiredResponse {
  error: string;
  accepts: PaymentOption[];
  x402Version: number;
}

// ============================================
// URL Validation Types
// ============================================

export interface URLValidationResult {
  valid: boolean;
  normalized?: string;
  error?: string;
}
