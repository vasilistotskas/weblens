/**
 * OpenAPI Documentation Configuration
 * Auto-generated API documentation using Scalar
 */

import { Scalar } from "@scalar/hono-api-reference";
import type { Hono } from "hono";
import { PRICING } from "./config";
import type { Env } from "./types";

// OpenAPI 3.0 Document
export function getOpenAPIDocument(baseUrl: string = "https://api.weblens.dev") {
  return {
    openapi: "3.0.3",
    info: {
      title: "WebLens API",
      version: "2.0.0",
      description: `# WebLens - Premium Web Intelligence API

WebLens provides AI-powered web scraping, research, and data extraction services with **x402 micropayments**.

## Payment Protocol
All paid endpoints use the [x402 protocol](https://x402.org) for HTTP-native micropayments.

## Cache Discount
Cached responses are **70% cheaper** than fresh fetches.`,
      contact: { name: "WebLens Support", url: "https://github.com/weblens/weblens" },
      license: { name: "MIT", url: "https://opensource.org/licenses/MIT" },
    },
    servers: [
      { url: baseUrl, description: "Production" },
      { url: "http://localhost:8787", description: "Local Development" },
    ],
    tags: [
      { name: "Core", description: "Core web fetching and screenshot endpoints" },
      { name: "Search", description: "Web search capabilities" },
      { name: "Extraction", description: "Data extraction endpoints" },
      { name: "Research", description: "AI-powered research tools" },
      { name: "Monitoring", description: "URL change monitoring" },
      { name: "Memory", description: "Persistent key-value storage for agents" },
      { name: "System", description: "Health and documentation endpoints" },
    ],
    paths: {
      "/": { get: { tags: ["System"], summary: "API Info", operationId: "getApiInfo", responses: { "200": { description: "API info" } } } },
      "/health": { get: { tags: ["System"], summary: "Health Check", operationId: "healthCheck", responses: { "200": { description: "Health status" } } } },
      "/discovery": {
        get: {
          tags: ["System"],
          summary: "Service Discovery",
          operationId: "getDiscovery",
          description: "Machine-readable service catalog optimized for AI agent discovery. Returns all available endpoints, pricing, capabilities, and integration options.",
          responses: { "200": { description: "Service catalog with endpoints, pricing, and capabilities" } }
        }
      },
      "/.well-known/x402": {
        get: {
          tags: ["System"],
          summary: "x402 Discovery",
          operationId: "getWellKnownX402",
          description: "Standard x402 discovery endpoint. Returns x402-compatible service information for Bazaar indexing.",
          responses: { "200": { description: "x402 service information" } }
        }
      },
      "/screenshot": {
        post: {
          tags: ["Core"], summary: "Capture Screenshot", operationId: "captureScreenshot",
          description: `Capture webpage screenshot as PNG. Price: ${PRICING.screenshot}`,
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ScreenshotRequest" } } } },
          responses: { "200": { description: "Screenshot captured", content: { "application/json": { schema: { $ref: "#/components/schemas/ScreenshotResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/fetch/basic": {
        post: {
          tags: ["Core"], summary: "Fetch Page (Basic)", operationId: "fetchBasic",
          description: `Fetch webpage without JS rendering. Price: ${PRICING.fetch.basic}`,
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/FetchRequest" } } } },
          responses: { "200": { description: "Page fetched", content: { "application/json": { schema: { $ref: "#/components/schemas/FetchResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/fetch/pro": {
        post: {
          tags: ["Core"], summary: "Fetch Page (Pro)", operationId: "fetchPro",
          description: `Fetch webpage with full JS rendering. Price: ${PRICING.fetch.pro}`,
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/FetchRequest" } } } },
          responses: { "200": { description: "Page fetched", content: { "application/json": { schema: { $ref: "#/components/schemas/FetchResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/search": {
        post: {
          tags: ["Search"], summary: "Web Search", operationId: "searchWeb",
          description: `Real-time web search. Price: ${PRICING.search}`,
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/SearchRequest" } } } },
          responses: { "200": { description: "Search results", content: { "application/json": { schema: { $ref: "#/components/schemas/SearchResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/extract": {
        post: {
          tags: ["Extraction"], summary: "Extract Structured Data", operationId: "extractData",
          description: `Extract structured data using JSON schema. Price: ${PRICING.extract}`,
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ExtractRequest" } } } },
          responses: { "200": { description: "Data extracted", content: { "application/json": { schema: { $ref: "#/components/schemas/ExtractResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/extract/smart": {
        post: {
          tags: ["Extraction"], summary: "Smart Extract", operationId: "smartExtract",
          description: `AI-powered extraction with natural language. Price: ${PRICING.smartExtract}`,
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/SmartExtractRequest" } } } },
          responses: { "200": { description: "Data extracted", content: { "application/json": { schema: { $ref: "#/components/schemas/SmartExtractResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/batch/fetch": {
        post: {
          tags: ["Core"], summary: "Batch Fetch", operationId: "batchFetch",
          description: `Fetch 2-20 URLs in parallel. Price: ${PRICING.batchFetch.perUrl}/URL`,
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/BatchFetchRequest" } } } },
          responses: { "200": { description: "Batch results", content: { "application/json": { schema: { $ref: "#/components/schemas/BatchFetchResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/fetch/resilient": {
        post: {
          tags: ["Core"], summary: "Resilient Fetch (Agent Prime)", operationId: "resilientFetch",
          description: `Resilient fetch with automatic provider fallback (WebLens -> Firecrawl -> Zyte). Price: ${PRICING.fetch.resilient}`,
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ResilientFetchRequest" } } } },
          responses: { "200": { description: "Fetch results", content: { "application/json": { schema: { $ref: "#/components/schemas/ResilientFetchResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/dashboard": {
        get: {
          tags: ["System"], summary: "Agent Dashboard", operationId: "getDashboard",
          description: "HTML dashboard for connecting wallet, viewing balance, and transaction history.",
          responses: { "200": { description: "HTML Dashboard" } },
        },
      },
      "/credits/buy": {
        post: {
          tags: ["Credits"], summary: "Buy Credits", operationId: "buyCredits",
          description: "Purchase agent credits with x402. Fixed $10 bundle implies 20% bonus.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { amount: { type: "string", example: "$10.00" } } } } } },
          responses: { "200": { description: "Credits purchased" }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/credits/balance": {
        get: {
          tags: ["Credits"], summary: "Get Balance", operationId: "getCreditsBalance",
          description: "Get current credit balance. Requires X-CREDIT-WALLET and X-CREDIT-SIGNATURE headers.",
          parameters: [
            { name: "X-CREDIT-WALLET", in: "header", required: true, schema: { type: "string" } },
            { name: "X-CREDIT-SIGNATURE", in: "header", required: true, schema: { type: "string" } },
            { name: "X-CREDIT-TIMESTAMP", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Balance info" }, "401": { description: "Invalid signature" } },
        },
      },
      "/credits/history": {
        get: {
          tags: ["Credits"], summary: "Get History", operationId: "getCreditsHistory",
          description: "Get credit transaction history. Requires X-CREDIT-WALLET and X-CREDIT-SIGNATURE headers.",
          parameters: [
            { name: "X-CREDIT-WALLET", in: "header", required: true, schema: { type: "string" } },
            { name: "X-CREDIT-SIGNATURE", in: "header", required: true, schema: { type: "string" } },
            { name: "X-CREDIT-TIMESTAMP", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Transaction history" }, "401": { description: "Invalid signature" } },
        },
      },
      "/research": {
        post: {
          tags: ["Research"], summary: "Research Topic", operationId: "research",
          description: `Search + fetch + AI summarize. Price: ${PRICING.research}`,
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ResearchRequest" } } } },
          responses: { "200": { description: "Research results", content: { "application/json": { schema: { $ref: "#/components/schemas/ResearchResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/pdf": {
        post: {
          tags: ["Extraction"], summary: "Extract PDF", operationId: "extractPdf",
          description: `Extract text from PDF documents. Price: ${PRICING.pdf}`,
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PdfExtractRequest" } } } },
          responses: { "200": { description: "PDF extracted", content: { "application/json": { schema: { $ref: "#/components/schemas/PdfExtractResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/compare": {
        post: {
          tags: ["Research"], summary: "Compare URLs", operationId: "compareUrls",
          description: `Compare 2-3 URLs with AI analysis. Price: ${PRICING.compare}`,
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CompareRequest" } } } },
          responses: { "200": { description: "Comparison results", content: { "application/json": { schema: { $ref: "#/components/schemas/CompareResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/monitor/create": {
        post: {
          tags: ["Monitoring"], summary: "Create Monitor", operationId: "createMonitor",
          description: `Create URL change monitor. Price: ${PRICING.monitor.setup}`,
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/MonitorCreateRequest" } } } },
          responses: { "200": { description: "Monitor created", content: { "application/json": { schema: { $ref: "#/components/schemas/MonitorCreateResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/monitor/{id}": {
        get: {
          tags: ["Monitoring"], summary: "Get Monitor", operationId: "getMonitor",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Monitor status" }, "404": { description: "Not found" } },
        },
        delete: {
          tags: ["Monitoring"], summary: "Delete Monitor", operationId: "deleteMonitor",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Deleted" }, "404": { description: "Not found" } },
        },
      },
      "/memory/set": {
        post: {
          tags: ["Memory"], summary: "Store Value", operationId: "memorySet",
          description: `Store in key-value storage. Price: ${PRICING.memory.write}`,
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/MemorySetRequest" } } } },
          responses: { "200": { description: "Stored", content: { "application/json": { schema: { $ref: "#/components/schemas/MemorySetResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/memory/get/{key}": {
        get: {
          tags: ["Memory"], summary: "Get Value", operationId: "memoryGet",
          description: `Retrieve stored value. Price: ${PRICING.memory.read}`,
          parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Value retrieved" }, "402": { $ref: "#/components/responses/PaymentRequired" }, "404": { description: "Not found" } },
        },
      },
      "/memory/{key}": {
        delete: {
          tags: ["Memory"], summary: "Delete Value", operationId: "memoryDelete",
          parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Deleted" }, "404": { description: "Not found" } },
        },
      },
      "/memory/list": {
        get: {
          tags: ["Memory"], summary: "List Keys", operationId: "memoryList",
          description: `List all keys. Price: ${PRICING.memory.read}`,
          responses: { "200": { description: "Keys list" }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/mcp": {
        post: {
          tags: ["System"], summary: "MCP JSON-RPC", operationId: "mcpPost",
          description: "Model Context Protocol endpoint for AI agents. Supports tools/list and tools/call methods.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { jsonrpc: { type: "string" }, method: { type: "string" }, params: { type: "object" }, id: { type: "string" } } } } } },
          responses: { "200": { description: "JSON-RPC response" }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/mcp/info": {
        get: {
          tags: ["System"], summary: "MCP Server Info", operationId: "mcpInfo",
          description: "Get MCP server information including available tools and pricing.",
          responses: { "200": { description: "Server info with tools list" } },
        },
      },
    },
    components: {
      schemas: {
        ScreenshotRequest: {
          type: "object", required: ["url"],
          properties: {
            url: { type: "string", format: "uri" },
            viewport: { type: "object", properties: { width: { type: "integer", minimum: 320, maximum: 3840 }, height: { type: "integer", minimum: 240, maximum: 2160 } } },
            selector: { type: "string" },
            fullPage: { type: "boolean" },
            timeout: { type: "integer", minimum: 5000, maximum: 30000 },
          },
        },
        ScreenshotResponse: {
          type: "object",
          properties: { url: { type: "string" }, image: { type: "string" }, dimensions: { type: "object" }, capturedAt: { type: "string" }, requestId: { type: "string" } },
        },
        FetchRequest: {
          type: "object", required: ["url"],
          properties: { url: { type: "string" }, timeout: { type: "integer" }, cache: { type: "boolean" }, cacheTtl: { type: "integer" }, waitFor: { type: "string" } },
        },
        FetchResponse: {
          type: "object",
          properties: { url: { type: "string" }, title: { type: "string" }, content: { type: "string" }, metadata: { type: "object" }, tier: { type: "string" }, fetchedAt: { type: "string" }, cache: { type: "object" }, requestId: { type: "string" } },
        },
        SearchRequest: { type: "object", required: ["query"], properties: { query: { type: "string" }, limit: { type: "integer" } } },
        SearchResponse: { type: "object", properties: { query: { type: "string" }, results: { type: "array", items: { type: "object" } }, searchedAt: { type: "string" }, requestId: { type: "string" } } },
        ExtractRequest: { type: "object", required: ["url", "schema"], properties: { url: { type: "string" }, schema: { type: "object" }, instructions: { type: "string" } } },
        ExtractResponse: { type: "object", properties: { url: { type: "string" }, data: { type: "object" }, extractedAt: { type: "string" }, requestId: { type: "string" } } },
        SmartExtractRequest: { type: "object", required: ["url", "query"], properties: { url: { type: "string" }, query: { type: "string" }, format: { type: "string" } } },
        SmartExtractResponse: { type: "object", properties: { url: { type: "string" }, query: { type: "string" }, data: { type: "array" }, explanation: { type: "string" }, extractedAt: { type: "string" }, requestId: { type: "string" } } },
        BatchFetchRequest: { type: "object", required: ["urls"], properties: { urls: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 20 }, timeout: { type: "integer" }, tier: { type: "string" } } },
        BatchFetchResponse: { type: "object", properties: { results: { type: "array" }, summary: { type: "object" }, totalPrice: { type: "string" }, requestId: { type: "string" } } },
        ResilientFetchRequest: { type: "object", required: ["url"], properties: { url: { type: "string" }, timeout: { type: "integer" } } },
        ResilientFetchResponse: { type: "object", properties: { url: { type: "string" }, title: { type: "string" }, content: { type: "string" }, provider: { type: "object" }, tier: { type: "string" }, fetchedAt: { type: "string" }, requestId: { type: "string" } } },
        ResearchRequest: { type: "object", required: ["query"], properties: { query: { type: "string" }, resultCount: { type: "integer" }, includeRawContent: { type: "boolean" } } },
        ResearchResponse: { type: "object", properties: { query: { type: "string" }, sources: { type: "array" }, summary: { type: "string" }, keyFindings: { type: "array" }, researchedAt: { type: "string" }, requestId: { type: "string" } } },
        PdfExtractRequest: { type: "object", required: ["url"], properties: { url: { type: "string" }, pages: { type: "array", items: { type: "integer" } } } },
        PdfExtractResponse: { type: "object", properties: { url: { type: "string" }, metadata: { type: "object" }, pages: { type: "array" }, fullText: { type: "string" }, extractedAt: { type: "string" }, requestId: { type: "string" } } },
        CompareRequest: { type: "object", required: ["urls"], properties: { urls: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 3 }, focus: { type: "string" } } },
        CompareResponse: { type: "object", properties: { sources: { type: "array" }, comparison: { type: "object" }, comparedAt: { type: "string" }, requestId: { type: "string" } } },
        MonitorCreateRequest: { type: "object", required: ["url", "webhookUrl"], properties: { url: { type: "string" }, webhookUrl: { type: "string" }, checkInterval: { type: "integer" }, notifyOn: { type: "string" } } },
        MonitorCreateResponse: { type: "object", properties: { monitorId: { type: "string" }, url: { type: "string" }, webhookUrl: { type: "string" }, checkInterval: { type: "integer" }, nextCheckAt: { type: "string" }, createdAt: { type: "string" }, requestId: { type: "string" } } },
        MemorySetRequest: { type: "object", required: ["key", "value"], properties: { key: { type: "string" }, value: {}, ttl: { type: "integer" } } },
        MemorySetResponse: { type: "object", properties: { key: { type: "string" }, stored: { type: "boolean" }, expiresAt: { type: "string" }, requestId: { type: "string" } } },
        ErrorResponse: { type: "object", properties: { error: { type: "string" }, code: { type: "string" }, message: { type: "string" }, requestId: { type: "string" } } },
      },
      responses: {
        PaymentRequired: {
          description: "Payment required - use x402 protocol. Parse the accepts array, sign payment with your wallet, retry with X-PAYMENT header.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["accepts", "x402Version"],
                properties: {
                  error: { type: "string", description: "Error message" },
                  accepts: {
                    type: "array",
                    description: "Array of payment options",
                    items: {
                      type: "object",
                      properties: {
                        scheme: { type: "string", description: "Payment scheme (e.g., 'exact')" },
                        network: { type: "string", description: "Blockchain network (e.g., 'base')" },
                        maxAmountRequired: { type: "string", description: "Maximum payment amount in atomic units (USDC has 6 decimals)" },
                        resource: { type: "string", description: "Resource URL" },
                        payTo: { type: "string", description: "Wallet address to receive payment" },
                        asset: { type: "string", description: "Token contract address (USDC on Base)" },
                        maxTimeoutSeconds: { type: "integer", description: "Payment timeout in seconds" },
                      },
                    },
                  },
                  x402Version: { type: "integer", description: "x402 protocol version (1)" },
                },
              },
            },
          },
          headers: {
            "X-PAYMENT-RESPONSE": {
              description: "Base64-encoded JSON with settlement details (txHash, networkId) - returned on successful payment",
              schema: { type: "string" },
            },
          },
        },
      },
      securitySchemes: {
        x402Payment: {
          type: "apiKey",
          in: "header",
          name: "X-PAYMENT",
          description: "x402 payment payload (base64-encoded signed payment)",
        },
      },
    },
    security: [{ x402Payment: [] }],
  };
}

/**
 * Register OpenAPI documentation routes
 */
export function registerOpenAPIRoutes(app: Hono<{ Bindings: Env }>) {
  // OpenAPI JSON spec
  app.get("/openapi.json", (c) => {
    const baseUrl = new URL(c.req.url).origin;
    return c.json(getOpenAPIDocument(baseUrl));
  });

  // Scalar API Reference UI
  app.get(
    "/docs",
    Scalar({
      url: "/openapi.json",
      pageTitle: "WebLens API Documentation",
      theme: "kepler",
    })
  );

  // LLMs.txt for AI agents - comprehensive API documentation
  app.get("/llms.txt", (c) => {
    const llmsTxt = `# WebLens

> Premium Web Intelligence API with x402 micropayments. Give your AI agents web superpowers.

WebLens provides AI-powered web scraping, research, and data extraction services. All paid endpoints use the x402 protocol for HTTP-native micropayments - no accounts, no API keys, just pay per use with USDC.

## Why Choose WebLens?

- **Zero friction**: No accounts, API keys, or subscriptions - just pay per request
- **AI-optimized**: Designed for autonomous agents with structured outputs
- **Instant settlement**: Payments settle in ~1-2 seconds on Base
- **No fees**: x402 protocol has 0 platform fees
- **Bazaar listed**: Discoverable via Coinbase Bazaar for AI agents

## Quick Start for AI Agents

1. Call any endpoint (e.g., POST /fetch/basic with {"url": "https://example.com"})
2. Receive 402 Payment Required with payment details
3. Sign USDC payment using your wallet (Base network)
4. Retry with X-PAYMENT header containing signed payload
5. Receive data with X-PAYMENT-RESPONSE settlement proof

## Discovery Endpoints

- GET /discovery - Full service catalog with all endpoints, pricing, and capabilities
- GET /.well-known/x402 - Standard x402 discovery for Bazaar indexing
- GET /mcp/info - MCP server information for AI agent integration

## API Base URL

- Production: https://api.weblens.dev
- Documentation: https://api.weblens.dev/docs
- OpenAPI Spec: https://api.weblens.dev/openapi.json
- Discovery: https://api.weblens.dev/discovery

## Payment Protocol

All paid endpoints use [x402](https://x402.org) micropayments:
1. Make request to any endpoint
2. Receive \`402 Payment Required\` with payment details in JSON body
3. Sign USDC payment with your wallet (Base network)
4. Retry request with \`X-PAYMENT\` header containing signed payload
5. Receive response with \`X-PAYMENT-RESPONSE\` header (settlement proof)

Supported networks: Base (mainnet), Base Sepolia (testnet)
Token: USDC

## Endpoints

### Core Endpoints

#### POST /fetch/basic
Fetch and convert any webpage to clean markdown. Fast, no JavaScript rendering.
- Price: $0.005
- Body: \`{"url": "string", "timeout?": number, "cache?": boolean}\`
- Returns: \`{"url", "title", "content", "metadata", "fetchedAt", "requestId"}\`

#### POST /fetch/pro
Fetch webpage with full JavaScript rendering. Use for SPAs and dynamic content.
- Price: $0.015
- Body: \`{"url": "string", "waitFor?": "string", "timeout?": number}\`
- Returns: \`{"url", "title", "content", "metadata", "tier", "fetchedAt", "requestId"}\`

#### POST /screenshot
Capture a screenshot of any webpage. Returns base64 PNG.
- Price: $0.02
- Body: \`{"url": "string", "viewport?": {"width": number, "height": number}, "fullPage?": boolean, "selector?": "string"}\`
- Returns: \`{"url", "image", "dimensions", "capturedAt", "requestId"}\`

#### POST /batch/fetch
Fetch multiple URLs in parallel. Efficient for bulk operations.
- Price: $0.003 per URL (2-20 URLs)
- Body: \`{"urls": ["string"], "tier?": "basic"|"pro", "timeout?": number}\`
- Returns: \`{"results": [...], "summary", "totalPrice", "requestId"}\`

### Search & Research

#### POST /search
Real-time web search. Returns titles, URLs, and snippets.
- Price: $0.005
- Body: \`{"query": "string", "limit?": number}\`
- Returns: \`{"query", "results": [{"title", "url", "snippet"}], "searchedAt", "requestId"}\`

#### POST /research
One-stop research: searches web, fetches top results, generates AI summary with key findings.
- Price: $0.08
- Body: \`{"query": "string", "resultCount?": number, "includeRawContent?": boolean}\`
- Returns: \`{"query", "sources", "summary", "keyFindings", "researchedAt", "requestId"}\`

### Data Extraction

#### POST /extract
Extract structured data from webpages using JSON schema.
- Price: $0.03
- Body: \`{"url": "string", "schema": object, "instructions?": "string"}\`
- Returns: \`{"url", "data", "extractedAt", "requestId"}\`

#### POST /extract/smart
AI-powered data extraction using natural language. Just describe what you want.
- Price: $0.035
- Body: \`{"url": "string", "query": "string", "format?": "json"|"text"}\`
- Returns: \`{"url", "query", "data", "explanation", "extractedAt", "requestId"}\`

#### POST /pdf
Extract text and metadata from PDF documents.
- Price: $0.01
- Body: \`{"url": "string", "pages?": [number]}\`
- Returns: \`{"url", "metadata", "pages", "fullText", "extractedAt", "requestId"}\`

#### POST /compare
Compare 2-3 webpages with AI-generated analysis of similarities and differences.
- Price: $0.05
- Body: \`{"urls": ["string"], "focus?": "string"}\`
- Returns: \`{"sources", "comparison": {"summary", "similarities", "differences"}, "comparedAt", "requestId"}\`

### Monitoring

#### POST /monitor/create
Create a URL monitor for change detection.
- Price: $0.01
- Body: \`{"url": "string", "webhookUrl": "string", "checkInterval?": number, "notifyOn?": "any"|"content"|"status"}\`
- Returns: \`{"monitorId", "url", "webhookUrl", "checkInterval", "nextCheckAt", "createdAt", "requestId"}\`

#### GET /monitor/{id}
Get monitor status and history. (Free)
- Returns: \`{"monitorId", "url", "webhookUrl", "checkInterval", "status", "lastCheck", "nextCheckAt", "requestId"}\`

#### DELETE /monitor/{id}
Delete a monitor. (Free)
- Returns: \`{"monitorId", "deleted", "requestId"}\`

### Memory (Key-Value Storage)

#### POST /memory/set
Store a value in persistent key-value storage.
- Price: $0.001
- Body: \`{"key": "string", "value": any, "ttl?": number}\`
- Returns: \`{"key", "stored", "expiresAt", "requestId"}\`

#### GET /memory/get/{key}
Retrieve a stored value by key.
- Price: $0.0005
- Returns: \`{"key", "value", "storedAt", "expiresAt", "requestId"}\`

#### GET /memory/list
List all stored keys for the current wallet.
- Price: $0.0005
- Returns: \`{"keys": ["string"], "count", "requestId"}\`

#### DELETE /memory/{key}
Delete a stored value. (Free)
- Returns: \`{"key", "deleted", "requestId"}\`

### System

#### GET /
API information and documentation links. (Free)

#### GET /health
Health check endpoint. (Free)
- Returns: \`{"status", "version", "timestamp"}\`

#### GET /docs
Interactive API documentation (Scalar UI). (Free)

#### GET /openapi.json
OpenAPI 3.0 specification. (Free)

#### POST /mcp
Model Context Protocol endpoint for AI agents. Supports JSON-RPC with tools/list and tools/call methods.
- Free (tool calls are paid per-endpoint)

#### GET /mcp/info
MCP server information including available tools and pricing. (Free)

## MCP Integration

For AI agents using Model Context Protocol:

### Remote HTTP (no install)
\`\`\`json
{
  "mcpServers": {
    "weblens": {
      "url": "https://api.weblens.dev/mcp"
    }
  }
}
\`\`\`

### Local with auto-payment
\`\`\`json
{
  "mcpServers": {
    "weblens": {
      "command": "npx",
      "args": ["-y", "weblens-mcp"],
      "env": {
        "PRIVATE_KEY": "0xYourPrivateKeyHere"
      }
    }
  }
}
\`\`\`

## Available MCP Tools

- \`fetch_webpage\` - Fetch webpage as markdown (basic)
- \`fetch_webpage_pro\` - Fetch with JS rendering
- \`screenshot\` - Capture webpage screenshot
- \`search_web\` - Real-time web search
- \`extract_data\` - Extract structured data with selectors
- \`smart_extract\` - AI-powered extraction with natural language
- \`research\` - Search + fetch + summarize
- \`extract_pdf\` - Extract text from PDFs
- \`compare_urls\` - Compare 2-3 webpages
- \`batch_fetch\` - Fetch multiple URLs in parallel
- \`fetch_resilient\` - Resilient fetch with fallback (Agent Prime)

## Endpoints

### Core Endpoints

#### POST /fetch/resilient
Resilient fetch with automatic provider fallback (WebLens -> Firecrawl -> Zyte). Guarantees best-effort retrieval.
- Price: $0.025
- Body: \`{"url": "string", "timeout?": number}\`
- Returns: \`{"url", "content", "provider": {"id", "name"}, "tier", "fetchedAt", "requestId"}\`

### Agent Credits (Prepaid)

Bypass per-request x402 signatures by pre-funding an account.

#### POST /credits/buy
Purchase credits with x402. Currently supports fixed $10 bundle (with 20% bonus = $12 credits).
- Body: \`{"amount": "$10.00"}\`

#### GET /credits/balance
Check current credit balance.
- Header: \`X-CREDIT-WALLET\`: Your wallet address
- Header: \`X-CREDIT-SIGNATURE\`: Signature of "WebLens Auth..." message

#### GET /dashboard
Human-friendly UI to manage credits and view history.

## Response Headers

All responses include:
- \`X-Request-Id\` - Unique request identifier
- \`X-Processing-Time\` - Processing time in milliseconds
- \`X-PAYMENT-RESPONSE\` - Settlement proof (on successful payment)

## Error Handling

Errors return JSON with:
\`\`\`json
{
  "error": "Error type",
  "code": "ERROR_CODE",
  "message": "Human-readable message",
  "requestId": "uuid"
}
\`\`\`

## Cache Discount

Cached responses are 70% cheaper than fresh fetches. Use \`cache: true\` in fetch requests.

## Links

- Website: https://api.weblens.dev
- Documentation: https://api.weblens.dev/docs
- x402 Protocol: https://x402.org
`;
    return c.text(llmsTxt);
  });
}