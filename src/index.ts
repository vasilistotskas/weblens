/**
 * WebLens - Premium Web Intelligence API
 * Main application entry point with x402 payment middleware
 * 
 * Requirements: All
 */

import { facilitator } from "@coinbase/x402";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Address } from "viem";
import { paymentMiddleware } from "x402-hono";
import { PRICING, SUPPORTED_NETWORKS } from "./config";
import { errorHandlerMiddleware } from "./middleware/errorHandler";
import { requestIdMiddleware } from "./middleware/requestId";
import { securityMiddleware } from "./middleware/security";
import { registerOpenAPIRoutes } from "./openapi";
import { batchFetchHandler } from "./tools/batch-fetch";
import { compareHandler } from "./tools/compare";
import { extractData } from "./tools/extract-data";
import { fetchBasic } from "./tools/fetch-basic";
import { fetchPro } from "./tools/fetch-pro";
import { health } from "./tools/health";
import { mcpPostHandler, mcpGetHandler, mcpInfoHandler } from "./tools/mcp";
import { memorySetHandler, memoryGetHandler, memoryDeleteHandler, memoryListHandler } from "./tools/memory";
import { monitorCreateHandler, monitorGetHandler, monitorDeleteHandler } from "./tools/monitor";
import { pdfHandler } from "./tools/pdf";
import { researchHandler } from "./tools/research";
import { screenshot } from "./tools/screenshot";
import { searchWeb } from "./tools/search-web";
import { smartExtractHandler } from "./tools/smart-extract";
import type { Env } from "./types";

// Default wallet for development - replace with your own
const WALLET_ADDRESS = (process.env.WALLET_ADDRESS ??
  "0x0000000000000000000000000000000000000000") as Address;

// CDP Facilitator for Bazaar discovery
// Requires CDP_API_KEY_ID and CDP_API_KEY_SECRET environment variables
const CDP_FACILITATOR = facilitator;

const app = new Hono<{ Bindings: Env }>();

// ============================================
// Global Middleware Chain
// ============================================

// Logging
app.use("*", logger());

// CORS
app.use("*", cors());

// Request ID and processing time tracking
// Requirement 5.3: Include X-Request-Id and X-Processing-Time headers
app.use("*", requestIdMiddleware);

// Global error handler
// Requirement 5.4: Consistent error response format
app.use("*", errorHandlerMiddleware);

// Security headers
app.use("*", securityMiddleware);


// ============================================
// OpenAPI Documentation Routes
// Requirement 5.1, 8.3, 8.4: Auto-generated API documentation
// ============================================
registerOpenAPIRoutes(app);

// API Documentation (free) - JSON summary
app.get("/", (c) => {
  return c.json({
    name: "WebLens",
    version: "2.0.0",
    description: "Premium Web Intelligence API with x402 micropayments",
    documentation: {
      interactive: "/docs",
      openapi: "/openapi.json",
      llms: "/llms.txt",
    },
    supportedNetworks: SUPPORTED_NETWORKS,
    x402: {
      version: 1,
      protocol: "https://x402.org",
      description: "HTTP-native micropayments using 402 Payment Required",
    },
  });
});

// Health check endpoint (free)
// Requirement 5.2: Return system health status
app.get("/health", health);


// ============================================
// x402 Payment Middleware for all endpoints
// Requirement 4.1: Multi-chain payment support
// Requirement 4.2: CDP facilitator for Base
// Requirement 4.3: PayAI facilitator for Solana/Polygon
// ============================================

// /fetch/basic - Basic tier fetch without JS rendering
app.use(
  "/fetch/basic",
  paymentMiddleware(
    WALLET_ADDRESS,
    {
      "/fetch/basic": {
        price: PRICING.fetch.basic,
        network: "base",
        config: {
          description: "Fetch and convert any webpage to clean markdown. Fast, no JavaScript rendering. POST with {url: string, timeout?: number, cache?: boolean}",
          discoverable: true,
        },
      },
    },
    CDP_FACILITATOR
  )
);

// /fetch/pro - Pro tier fetch with full JS rendering
app.use(
  "/fetch/pro",
  paymentMiddleware(
    WALLET_ADDRESS,
    {
      "/fetch/pro": {
        price: PRICING.fetch.pro,
        network: "base",
        config: {
          description: "Fetch webpage with full JavaScript rendering. Use for SPAs and dynamic content. POST with {url: string, waitFor?: string, timeout?: number}",
          discoverable: true,
        },
      },
    },
    CDP_FACILITATOR
  )
);

// /screenshot - Capture webpage screenshots
app.use(
  "/screenshot",
  paymentMiddleware(
    WALLET_ADDRESS,
    {
      "/screenshot": {
        price: PRICING.screenshot,
        network: "base",
        config: {
          description: "Capture a screenshot of any webpage. Returns base64 PNG. POST with {url: string, viewport?: {width, height}, fullPage?: boolean}",
          discoverable: true,
        },
      },
    },
    CDP_FACILITATOR
  )
);

// /search - Real-time web search
app.use(
  "/search",
  paymentMiddleware(
    WALLET_ADDRESS,
    {
      "/search": {
        price: PRICING.search,
        network: "base",
        config: {
          description: "Real-time web search. Returns titles, URLs, and snippets. POST with {query: string, limit?: number}",
          discoverable: true,
        },
      },
    },
    CDP_FACILITATOR
  )
);

// /extract - Structured data extraction
app.use(
  "/extract",
  paymentMiddleware(
    WALLET_ADDRESS,
    {
      "/extract": {
        price: PRICING.extract,
        network: "base",
        config: {
          description: "Extract structured data from webpages using JSON schema. POST with {url: string, schema: object, instructions?: string}",
          discoverable: true,
        },
      },
    },
    CDP_FACILITATOR
  )
);

// ============================================
// Advanced Endpoint Payment Middleware
// Requirements: 1.4, 2.6, 3.5, 4.2, 5.4, 6.4, 7.2, 8.1
// ============================================

// /batch/fetch - Batch URL fetching
// Note: Price is per-URL, middleware uses base price for 2 URLs minimum
app.use(
  "/batch/fetch",
  paymentMiddleware(
    WALLET_ADDRESS,
    {
      "/batch/fetch": {
        price: "$0.006", // Minimum price for 2 URLs
        network: "base",
        config: {
          description: "Fetch multiple URLs in parallel. Efficient for bulk operations. POST with {urls: string[], tier?: 'basic'|'pro'}. Price: $0.003/URL",
          discoverable: true,
        },
      },
    },
    CDP_FACILITATOR
  )
);

// /research - One-stop research
app.use(
  "/research",
  paymentMiddleware(
    WALLET_ADDRESS,
    {
      "/research": {
        price: PRICING.research,
        network: "base",
        config: {
          description: "One-stop research: searches web, fetches top results, generates AI summary with key findings. POST with {query: string, resultCount?: number}",
          discoverable: true,
        },
      },
    },
    CDP_FACILITATOR
  )
);

// /extract/smart - AI-powered smart extraction
app.use(
  "/extract/smart",
  paymentMiddleware(
    WALLET_ADDRESS,
    {
      "/extract/smart": {
        price: PRICING.smartExtract,
        network: "base",
        config: {
          description: "AI-powered data extraction using natural language. Just describe what you want. POST with {url: string, query: string, format?: 'json'|'text'}",
          discoverable: true,
        },
      },
    },
    CDP_FACILITATOR
  )
);

// /pdf - PDF text extraction
app.use(
  "/pdf",
  paymentMiddleware(
    WALLET_ADDRESS,
    {
      "/pdf": {
        price: PRICING.pdf,
        network: "base",
        config: {
          description: "Extract text and metadata from PDF documents. POST with {url: string, pages?: number[]}",
          discoverable: true,
        },
      },
    },
    CDP_FACILITATOR
  )
);

// /compare - URL comparison
app.use(
  "/compare",
  paymentMiddleware(
    WALLET_ADDRESS,
    {
      "/compare": {
        price: PRICING.compare,
        network: "base",
        config: {
          description: "Compare 2-3 webpages with AI-generated analysis of similarities and differences. POST with {urls: string[], focus?: string}",
          discoverable: true,
        },
      },
    },
    CDP_FACILITATOR
  )
);

// /monitor/create - Create URL monitor
app.use(
  "/monitor/create",
  paymentMiddleware(
    WALLET_ADDRESS,
    {
      "/monitor/create": {
        price: PRICING.monitor.setup,
        network: "base",
        config: {
          description: "Create a URL monitor for change detection",
          discoverable: true,
        },
      },
    },
    CDP_FACILITATOR
  )
);

// /memory/set - Store value
app.use(
  "/memory/set",
  paymentMiddleware(
    WALLET_ADDRESS,
    {
      "/memory/set": {
        price: PRICING.memory.write,
        network: "base",
        config: {
          description: "Store a value in persistent key-value storage",
          discoverable: true,
        },
      },
    },
    CDP_FACILITATOR
  )
);

// /memory/get/* - Retrieve value
app.use(
  "/memory/get/*",
  paymentMiddleware(
    WALLET_ADDRESS,
    {
      "/memory/get/*": {
        price: PRICING.memory.read,
        network: "base",
        config: {
          description: "Retrieve a stored value by key",
          discoverable: true,
        },
      },
    },
    CDP_FACILITATOR
  )
);

// /memory/list - List keys
app.use(
  "/memory/list",
  paymentMiddleware(
    WALLET_ADDRESS,
    {
      "/memory/list": {
        price: PRICING.memory.read,
        network: "base",
        config: {
          description: "List all stored keys for the current wallet",
          discoverable: true,
        },
      },
    },
    CDP_FACILITATOR
  )
);


// ============================================
// Route Handlers
// ============================================

// Tiered fetch endpoints
app.post("/fetch/basic", fetchBasic);
app.post("/fetch/pro", fetchPro);

// Screenshot endpoint
app.post("/screenshot", screenshot);

// Other paid endpoints
app.post("/search", searchWeb);
app.post("/extract", extractData);

// ============================================
// Advanced Route Handlers
// ============================================

// Batch fetch endpoint
app.post("/batch/fetch", batchFetchHandler);

// Research endpoint
app.post("/research", researchHandler);

// Smart extraction endpoint
app.post("/extract/smart", smartExtractHandler);

// PDF extraction endpoint
app.post("/pdf", pdfHandler);

// Compare endpoint
app.post("/compare", compareHandler);

// Monitor endpoints
app.post("/monitor/create", monitorCreateHandler);
app.get("/monitor/:id", monitorGetHandler);
app.delete("/monitor/:id", monitorDeleteHandler);

// Memory endpoints
app.post("/memory/set", memorySetHandler);
app.get("/memory/get/:key", memoryGetHandler);
app.delete("/memory/:key", memoryDeleteHandler);
app.get("/memory/list", memoryListHandler);

// ============================================
// MCP (Model Context Protocol) Endpoint
// Allows AI agents to connect via HTTP transport
// ============================================
app.post("/mcp", mcpPostHandler);
app.get("/mcp", mcpGetHandler);
app.get("/mcp/info", mcpInfoHandler);

// Export Durable Object class for wrangler
export { MonitorScheduler } from "./services/scheduler";

export default app;
