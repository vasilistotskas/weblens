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
import { requestIdMiddleware } from "./middleware/requestId";
import { errorHandlerMiddleware } from "./middleware/errorHandler";
import { PRICING, FACILITATORS, SUPPORTED_NETWORKS } from "./config";
import { getCachedPrice } from "./utils/pricing";
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

// API Documentation (free)
// Requirement 5.1: Return API documentation including all endpoints, pricing, and supported features
app.get("/", (c) => {
  return c.json({
    name: "WebLens",
    version: "1.0.0",
    description: "Premium Web Intelligence API with x402 micropayments",
    documentation: "https://github.com/weblens/weblens",
    endpoints: {
      "/screenshot": {
        method: "POST",
        price: PRICING.screenshot,
        cachedPrice: getCachedPrice(PRICING.screenshot),
        description: "Capture webpage screenshot as PNG",
        features: ["viewport customization", "element selection", "full page capture"],
      },
      "/fetch/basic": {
        method: "POST",
        price: PRICING.fetch.basic,
        cachedPrice: getCachedPrice(PRICING.fetch.basic),
        description: "Fetch webpage without JavaScript rendering",
        features: ["fast response", "markdown output", "metadata extraction"],
      },
      "/fetch/pro": {
        method: "POST",
        price: PRICING.fetch.pro,
        cachedPrice: getCachedPrice(PRICING.fetch.pro),
        description: "Fetch webpage with full JavaScript rendering",
        features: ["dynamic content", "SPA support", "wait for selectors"],
      },

      "/search": {
        method: "POST",
        price: PRICING.search,
        cachedPrice: getCachedPrice(PRICING.search),
        description: "Real-time web search results",
        features: ["DuckDuckGo backend", "configurable limit"],
      },
      "/extract": {
        method: "POST",
        price: PRICING.extract,
        cachedPrice: getCachedPrice(PRICING.extract),
        description: "Extract structured data from webpages",
        features: ["JSON schema", "AI-powered extraction", "custom instructions"],
      },
      "/health": {
        method: "GET",
        price: "free",
        description: "System health status",
      },
    },
    pricing: {
      cacheDiscount: "70%",
      note: "Cached responses are 70% cheaper than fresh fetches",
    },
    supportedNetworks: SUPPORTED_NETWORKS,
    facilitators: {
      base: FACILITATORS.cdp,
      "base-sepolia": FACILITATORS.cdp,
      solana: FACILITATORS.payai,
      polygon: FACILITATORS.payai,
    },
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

export default app;
