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
          description: "Fetch and convert any webpage to clean markdown. Fast, no JavaScript rendering. Perfect for static content, articles, and documentation.",
          discoverable: true,
          inputSchema: {
            bodyType: "json" as const,
            bodyFields: {
              url: { type: "string", description: "URL of the webpage to fetch", required: true },
              timeout: { type: "number", description: "Request timeout in milliseconds (default: 10000)" },
              cache: { type: "boolean", description: "Enable caching (default: true)" },
              cacheTtl: { type: "number", description: "Cache TTL in seconds, 60-86400 (default: 3600)" },
            },
          },
          outputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "Fetched URL" },
              title: { type: "string", description: "Page title" },
              content: { type: "string", description: "Clean markdown content" },
              tier: { type: "string" },
              fetchedAt: { type: "string", description: "ISO timestamp" },
              requestId: { type: "string" },
            },
          },
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
          description: "Fetch webpage with full JavaScript rendering using headless browser. Perfect for SPAs, React/Vue apps, and dynamic content that requires JS execution.",
          discoverable: true,
          inputSchema: {
            bodyType: "json" as const,
            bodyFields: {
              url: { type: "string", description: "URL of the webpage to fetch", required: true },
              waitFor: { type: "string", description: "CSS selector to wait for before capturing content" },
              timeout: { type: "number", description: "Request timeout in milliseconds (default: 15000)" },
              cache: { type: "boolean", description: "Enable caching (default: true)" },
            },
          },
          outputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "Fetched URL" },
              title: { type: "string", description: "Page title" },
              content: { type: "string", description: "Clean markdown content after JS rendering" },
              tier: { type: "string" },
              fetchedAt: { type: "string", description: "ISO timestamp" },
              requestId: { type: "string" },
            },
          },
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
          description: "Capture high-quality screenshots of any webpage using headless browser. Supports custom viewport sizes, full-page capture, and element-specific screenshots.",
          discoverable: true,
          inputSchema: {
            bodyType: "json" as const,
            bodyFields: {
              url: { type: "string", description: "URL of the webpage to screenshot", required: true },
              selector: { type: "string", description: "CSS selector to capture specific element" },
              fullPage: { type: "boolean", description: "Capture entire scrollable page (default: false)" },
              timeout: { type: "number", description: "Timeout in ms, 5000-30000 (default: 10000)" },
            },
          },
          outputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "Screenshotted URL" },
              image: { type: "string", description: "Base64-encoded PNG image" },
              capturedAt: { type: "string", description: "ISO timestamp" },
              requestId: { type: "string" },
            },
          },
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
          description: "Real-time web search powered by Google. Returns ranked results with titles, URLs, and snippets. Perfect for AI agents needing current information.",
          discoverable: true,
          inputSchema: {
            bodyType: "json" as const,
            bodyFields: {
              query: { type: "string", description: "Search query", required: true },
              limit: { type: "number", description: "Number of results to return (default: 10, max: 20)" },
            },
          },
          outputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Original search query" },
              results: { type: "array", description: "Array of search results with title, url, snippet" },
              searchedAt: { type: "string", description: "ISO timestamp" },
              requestId: { type: "string" },
            },
          },
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
          description: "Extract structured data from any webpage using JSON schema. AI-powered extraction that understands page context. Great for scraping product info, articles, contacts, etc.",
          discoverable: true,
          inputSchema: {
            bodyType: "json" as const,
            bodyFields: {
              url: { type: "string", description: "URL of the webpage to extract from", required: true },
              schema: { type: "object", description: "JSON schema defining the data structure to extract", required: true },
              instructions: { type: "string", description: "Natural language instructions to guide extraction" },
            },
          },
          outputSchema: {
            type: "object",
            properties: {
              url: { type: "string", description: "Source URL" },
              data: { type: "object", description: "Extracted data matching the provided schema" },
              extractedAt: { type: "string", description: "ISO timestamp" },
              requestId: { type: "string" },
            },
          },
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
          description: "Fetch multiple URLs in parallel with a single request. Efficient for bulk operations. Supports 2-20 URLs per request at $0.003/URL.",
          discoverable: true,
          inputSchema: {
            bodyType: "json" as const,
            bodyFields: {
              urls: { type: "array", description: "Array of URLs to fetch (2-20)", required: true },
              timeout: { type: "number", description: "Per-URL timeout in ms (default: 10000)" },
              tier: { type: "string", description: "Fetch tier: basic or pro (default: basic)" },
            },
          },
          outputSchema: {
            type: "object",
            properties: {
              results: { type: "array", description: "Array of fetch results with url, status, content, title" },
              summary: { type: "object", description: "Summary with total, successful, failed counts" },
              totalPrice: { type: "string" },
              requestId: { type: "string" },
            },
          },
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
          description: "One-stop research assistant: searches the web, fetches top results, and generates an AI-powered summary with key findings. Perfect for quick research tasks.",
          discoverable: true,
          inputSchema: {
            bodyType: "json" as const,
            bodyFields: {
              query: { type: "string", description: "Research topic or question", required: true },
              resultCount: { type: "number", description: "Number of sources to analyze, 1-10 (default: 5)" },
              includeRawContent: { type: "boolean", description: "Include full fetched content in response" },
            },
          },
          outputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
              sources: { type: "array", description: "Array of sources with url, title, snippet" },
              summary: { type: "string", description: "AI-generated research summary" },
              keyFindings: { type: "array", description: "Bullet points of key findings" },
              researchedAt: { type: "string" },
              requestId: { type: "string" },
            },
          },
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
          description: "AI-powered data extraction using natural language. No schema needed - just describe what you want to extract in plain English.",
          discoverable: true,
          inputSchema: {
            bodyType: "json" as const,
            bodyFields: {
              url: { type: "string", description: "URL of the webpage to extract from", required: true },
              query: { type: "string", description: "Natural language description of what to extract (e.g., 'find all email addresses')", required: true },
              format: { type: "string", description: "Output format: json or text (default: json)" },
            },
          },
          outputSchema: {
            type: "object",
            properties: {
              url: { type: "string" },
              query: { type: "string" },
              data: { type: "array", description: "Array of extracted items with value, context, confidence" },
              explanation: { type: "string", description: "AI explanation of extraction" },
              extractedAt: { type: "string" },
              requestId: { type: "string" },
            },
          },
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
          description: "Extract text and metadata from PDF documents. Supports page-specific extraction and returns structured content.",
          discoverable: true,
          inputSchema: {
            bodyType: "json" as const,
            bodyFields: {
              url: { type: "string", description: "URL of the PDF document", required: true },
              pages: { type: "array", description: "Specific page numbers to extract (omit for all pages)" },
            },
          },
          outputSchema: {
            type: "object",
            properties: {
              url: { type: "string" },
              metadata: { type: "object", description: "PDF metadata with title, author, pageCount" },
              pages: { type: "array", description: "Array of pages with pageNumber and content" },
              fullText: { type: "string", description: "All pages concatenated" },
              extractedAt: { type: "string" },
              requestId: { type: "string" },
            },
          },
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
          description: "Compare 2-3 webpages with AI-generated analysis. Identifies similarities, differences, and provides a comprehensive summary. Great for product comparisons, article analysis, etc.",
          discoverable: true,
          inputSchema: {
            bodyType: "json" as const,
            bodyFields: {
              urls: { type: "array", description: "Array of 2-3 URLs to compare", required: true },
              focus: { type: "string", description: "What aspect to focus the comparison on (e.g., 'pricing', 'features')" },
            },
          },
          outputSchema: {
            type: "object",
            properties: {
              sources: { type: "array", description: "Array of sources with url, title, content" },
              comparison: { type: "object", description: "Comparison with similarities, differences, summary" },
              comparedAt: { type: "string" },
              requestId: { type: "string" },
            },
          },
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
          description: "Create a URL monitor for change detection. Get notified via webhook when page content or status changes. Supports 1-24 hour check intervals.",
          discoverable: true,
          inputSchema: {
            bodyType: "json" as const,
            bodyFields: {
              url: { type: "string", description: "URL to monitor for changes", required: true },
              webhookUrl: { type: "string", description: "Webhook URL to receive change notifications", required: true },
              checkInterval: { type: "number", description: "Check interval in hours, 1-24 (default: 1)" },
              notifyOn: { type: "string", description: "What triggers notification: any, content, or status (default: any)" },
            },
          },
          outputSchema: {
            type: "object",
            properties: {
              monitorId: { type: "string" },
              url: { type: "string" },
              webhookUrl: { type: "string" },
              checkInterval: { type: "number" },
              nextCheckAt: { type: "string" },
              createdAt: { type: "string" },
              requestId: { type: "string" },
            },
          },
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
          description: "Store a value in persistent key-value storage. Perfect for AI agents to remember context across sessions. Supports JSON values up to 100KB with configurable TTL.",
          discoverable: true,
          inputSchema: {
            bodyType: "json" as const,
            bodyFields: {
              key: { type: "string", description: "Storage key (max 256 chars)", required: true },
              value: { type: "object", description: "JSON-serializable value (max 100KB)", required: true },
              ttl: { type: "number", description: "Time-to-live in hours, 1-720 (default: 168 = 7 days)" },
            },
          },
          outputSchema: {
            type: "object",
            properties: {
              key: { type: "string" },
              stored: { type: "boolean" },
              expiresAt: { type: "string" },
              requestId: { type: "string" },
            },
          },
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
          description: "Retrieve a stored value by key from persistent storage. Use GET /memory/get/{key} to fetch previously stored data.",
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
          description: "List all stored keys for the current wallet. Returns all active keys in your persistent storage namespace.",
          discoverable: true,
          outputSchema: {
            type: "object",
            properties: {
              keys: { type: "array", description: "Array of stored keys" },
              count: { type: "number" },
              requestId: { type: "string" },
            },
          },
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
