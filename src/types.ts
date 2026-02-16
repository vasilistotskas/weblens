/**
 * WebLens Type Definitions
 * All request/response interfaces for the API
 */

// Environment bindings for Cloudflare Workers
export interface Env {
  PAY_TO_ADDRESS: string;
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
  MEMORY?: KVNamespace; // Cloudflare KV for agent memory
  MONITOR?: KVNamespace; // Cloudflare KV for URL monitors
  CREDITS?: KVNamespace; // Cloudflare KV for agent credit accounts
  MONITOR_SCHEDULER?: DurableObjectNamespace; // Durable Object for monitor scheduling
  // Optional API keys
  SERP_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  // Legacy facilitator URLs (for multi-chain support)
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
  | "INTERNAL_ERROR"
  | "BATCH_TOO_SMALL"
  | "BATCH_TOO_LARGE"
  | "INVALID_PDF"
  | "PDF_TOO_LARGE"
  | "MONITOR_NOT_FOUND"
  | "WEBHOOK_INVALID"
  | "EXTRACTION_FAILED"
  | "RESEARCH_FAILED"
  | "AI_UNAVAILABLE"
  | "MEMORY_KEY_NOT_FOUND"
  | "MEMORY_VALUE_TOO_LARGE";

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

// ============================================
// Batch Fetch Types (Requirement 1)
// ============================================

export interface BatchFetchRequest {
  urls: string[];           // 2-20 URLs
  timeout?: number;         // Per-URL timeout, default 10000ms
  tier?: "basic" | "pro";   // Fetch tier, default "basic"
}

export interface BatchFetchResult {
  url: string;
  status: "success" | "error";
  content?: string;         // Markdown content if success
  title?: string;
  metadata?: PageMetadata;
  error?: string;           // Error message if failed
  fetchedAt: string;
}

export interface BatchFetchResponse {
  results: BatchFetchResult[];
  summary: {
    total: number;
    successful: number;
    failed: number;
  };
  totalPrice: string;       // e.g., "$0.030" for 10 URLs
  requestId: string;
}

// ============================================
// Research Types (Requirement 2)
// ============================================

export interface ResearchRequest {
  query: string;            // Research topic/question
  resultCount?: number;     // 1-10, default 5
  includeRawContent?: boolean; // Include full fetched content
}

export interface ResearchSource {
  url: string;
  title: string;
  snippet: string;
  content?: string;         // Full content if includeRawContent
  fetchedAt: string;
}

export interface ResearchResponse {
  query: string;
  sources: ResearchSource[];
  summary: string;          // AI-generated summary
  keyFindings: string[];    // Bullet points of key findings
  researchedAt: string;
  requestId: string;
}

// ============================================
// Smart Extraction Types (Requirement 3)
// ============================================

export interface SmartExtractRequest {
  url: string;
  query: string;            // e.g., "find all email addresses"
  format?: "json" | "text"; // Output format, default "json"
}

export interface ExtractedItem {
  value: unknown;           // Extracted value
  context?: string;         // Surrounding context
  confidence: number;       // 0-1 confidence score
}

export interface SmartExtractResponse {
  url: string;
  query: string;
  data: ExtractedItem[];
  explanation: string;      // AI explanation of extraction
  extractedAt: string;
  requestId: string;
}

// ============================================
// Monitor Types (Requirement 4)
// ============================================

export interface MonitorCreateRequest {
  url: string;
  webhookUrl: string;
  checkInterval?: number;   // Hours, 1-24, default 1
  notifyOn?: "any" | "content" | "status"; // What triggers notification
}

export interface MonitorCreateResponse {
  monitorId: string;
  url: string;
  webhookUrl: string;
  checkInterval: number;
  nextCheckAt: string;
  createdAt: string;
  requestId: string;
}

export interface MonitorStatus {
  monitorId: string;
  url: string;
  status: "active" | "paused" | "error";
  lastCheck?: {
    checkedAt: string;
    changed: boolean;
    contentHash: string;
  };
  checkCount: number;
  totalCost: string;        // Total spent on checks
  createdAt: string;
}

export interface WebhookPayload {
  monitorId: string;
  url: string;
  changeType: "content" | "status" | "error";
  previousHash?: string;
  currentHash?: string;
  diff?: string;            // Summary of changes
  checkedAt: string;
}

export interface StoredMonitor {
  id: string;
  url: string;
  webhookUrl: string;
  checkInterval: number;
  notifyOn: "any" | "content" | "status";
  status: "active" | "paused" | "error";
  lastContentHash?: string;
  lastStatusCode?: number;
  checkCount: number;
  totalCost: number;        // In cents
  createdAt: string;
  lastCheckAt?: string;
  nextCheckAt: string;
  ownerId?: string;         // Wallet address
}

// ============================================
// PDF Extraction Types (Requirement 5)
// ============================================

export interface PdfExtractRequest {
  url: string;
  pages?: number[];         // Specific pages, or all if omitted
}

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
// Compare Types (Requirement 6)
// ============================================

export interface CompareRequest {
  urls: string[];           // 2-3 URLs
  focus?: string;           // What to focus comparison on
}

export interface CompareSource {
  url: string;
  title: string;
  content: string;
}

export interface CompareResponse {
  sources: CompareSource[];
  comparison: {
    similarities: string[];
    differences: string[];
    summary: string;        // AI-generated comparison summary
  };
  comparedAt: string;
  requestId: string;
}

// ============================================
// Agent Memory Types (Requirement 7)
// ============================================

export interface MemorySetRequest {
  key: string;              // Max 256 chars
  value: unknown;           // JSON-serializable, max 100KB
  ttl?: number;             // Hours, 1-720 (30 days), default 168 (7 days)
}

export interface MemorySetResponse {
  key: string;
  stored: boolean;
  expiresAt: string;
  requestId: string;
}

export interface MemoryGetResponse {
  key: string;
  value: unknown;
  storedAt: string;
  expiresAt: string;
  requestId: string;
}

export interface MemoryListResponse {
  keys: string[];
  count: number;
  requestId: string;
}

// ============================================
// Free Tier Types
// ============================================

export interface FreeTierMetadata {
  tier: "free";
  limits: {
    contentLength?: number;
    maxResults?: number;
    requestsPerHour: number;
  };
  remainingRequests: number;
  upgradeUrl: string;
  message: string;
}

