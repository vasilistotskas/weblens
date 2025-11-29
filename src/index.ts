/**
 * WebLens - Premium Web Intelligence API
 * Main application entry point with x402 payment middleware
 * 
 * Requirements: All
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { paymentMiddleware } from "x402-hono";
import { fetchBasic } from "./tools/fetch-basic";
import { fetchPro } from "./tools/fetch-pro";
import { searchWeb } from "./tools/search-web";
import { extractData } from "./tools/extract-data";
import { screenshot } from "./tools/screenshot";
import { health } from "./tools/health";
import { batchFetchHandler } from "./tools/batch-fetch";
import { researchHandler } from "./tools/research";
import { smartExtractHandler } from "./tools/smart-extract";
import { pdfHandler } from "./tools/pdf";
import { compareHandler } from "./tools/compare";
import { monitorCreateHandler, monitorGetHandler, monitorDeleteHandler } from "./tools/monitor";
import { memorySetHandler, memoryGetHandler, memoryDeleteHandler, memoryListHandler } from "./tools/memory";
import { requestIdMiddleware } from "./middleware/requestId";
import { errorHandlerMiddleware } from "./middleware/errorHandler";
import { securityMiddleware } from "./middleware/security";
import { PRICING, FACILITATORS, SUPPORTED_NETWORKS } from "./config";
import { getCachedPrice } from "./utils/pricing";
import { registerOpenAPIRoutes } from "./openapi";
import type { Env } from "./types";
import type { Address } from "viem";

// Default wallet for development - replace with your own
const WALLET_ADDRESS = (process.env.WALLET_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as Address;

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
        network: "base-sepolia",
        config: {
          description: "Fetch webpage without JavaScript rendering (basic tier)",
          discoverable: true,
        },
      },
    },
    { url: FACILITATORS.cdp }
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
        network: "base-sepolia",
        config: {
          description: "Fetch webpage with full JavaScript rendering (pro tier)",
          discoverable: true,
        },
      },
    },
    { url: FACILITATORS.cdp }
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
        network: "base-sepolia",
        config: {
          description: "Capture webpage screenshot",
          discoverable: true,
        },
      },
    },
    { url: FACILITATORS.cdp }
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
        network: "base-sepolia",
        config: {
          description: "Real-time web search results",
          discoverable: true,
        },
      },
    },
    { url: FACILITATORS.cdp }
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
        network: "base-sepolia",
        config: {
          description: "Extract structured data from webpages",
          discoverable: true,
        },
      },
    },
    { url: FACILITATORS.cdp }
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
        network: "base-sepolia",
        config: {
          description: "Fetch multiple URLs in parallel (2-20 URLs, $0.003/URL)",
          discoverable: true,
        },
      },
    },
    { url: FACILITATORS.cdp }
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
        network: "base-sepolia",
        config: {
          description: "Search, fetch, and AI-summarize research topics",
          discoverable: true,
        },
      },
    },
    { url: FACILITATORS.cdp }
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
        network: "base-sepolia",
        config: {
          description: "AI-powered data extraction using natural language queries",
          discoverable: true,
        },
      },
    },
    { url: FACILITATORS.cdp }
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
        network: "base-sepolia",
        config: {
          description: "Extract text and metadata from PDF documents",
          discoverable: true,
        },
      },
    },
    { url: FACILITATORS.cdp }
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
        network: "base-sepolia",
        config: {
          description: "Compare 2-3 URLs with AI-generated analysis",
          discoverable: true,
        },
      },
    },
    { url: FACILITATORS.cdp }
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
        network: "base-sepolia",
        config: {
          description: "Create a URL monitor for change detection",
          discoverable: true,
        },
      },
    },
    { url: FACILITATORS.cdp }
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
        network: "base-sepolia",
        config: {
          description: "Store a value in persistent key-value storage",
          discoverable: true,
        },
      },
    },
    { url: FACILITATORS.cdp }
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
        network: "base-sepolia",
        config: {
          description: "Retrieve a stored value by key",
          discoverable: true,
        },
      },
    },
    { url: FACILITATORS.cdp }
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
        network: "base-sepolia",
        config: {
          description: "List all stored keys for the current wallet",
          discoverable: true,
        },
      },
    },
    { url: FACILITATORS.cdp }
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

// Export Durable Object class for wrangler
export { MonitorScheduler } from "./services/scheduler";

export default app;
