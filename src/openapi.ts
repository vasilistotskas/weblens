/**
 * OpenAPI Documentation Configuration
 * Auto-generated API documentation using Scalar
 */

import { Scalar } from "@scalar/hono-api-reference";
import type { Hono } from "hono";
import { PRICING } from "./config";
import type { Env, Variables } from "./types";

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
      { name: "Free", description: "Free tier endpoints — no payment required" },
      { name: "Core", description: "Core web fetching and screenshot endpoints" },
      { name: "Search", description: "Web search capabilities" },
      { name: "Extraction", description: "Data extraction endpoints" },
      { name: "Research", description: "AI-powered research tools" },
      { name: "Intelligence", description: "Premium AI-powered intelligence products" },
      { name: "Monitoring", description: "URL change monitoring" },
      { name: "Memory", description: "Persistent key-value storage for agents" },
      { name: "System", description: "Health and documentation endpoints" },
      { name: "Credits", description: "Prepaid credit system" },
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
      "/r/{url}": {
        get: {
          tags: ["Free"],
          summary: "Reader Mode (Zero-Friction)",
          operationId: "readerFetch",
          description: "Fetch any webpage as markdown with a single GET request. No auth, no payment, no POST body. Just append a URL. Rate limited to 10/hour, content truncated to 2000 chars. Inspired by Jina Reader.",
          parameters: [
            { name: "url", in: "path", required: true, schema: { type: "string" }, description: "Full URL to fetch (e.g. https://example.com/article)", example: "https://example.com" },
            { name: "format", in: "query", required: false, schema: { type: "string", enum: ["json", "text"] }, description: "Response format: json (default) or text (plain markdown)" },
          ],
          responses: {
            "200": { description: "Page content as markdown (JSON or plain text)" },
            "400": { description: "Invalid or missing URL" },
            "429": { description: "Rate limit exceeded (10/hour)" },
            "502": { description: "Target URL timeout" },
          },
        },
      },
      "/s/{query}": {
        get: {
          tags: ["Free"],
          summary: "Search Reader (Zero-Friction)",
          operationId: "searchReader",
          description: "Search the web with a single GET request. No auth, no payment, no POST body. Just append a query. Rate limited to 10/hour, max 3 results. Upgrade to POST /search for up to 20 results.",
          parameters: [
            { name: "query", in: "path", required: true, schema: { type: "string" }, description: "Search query (use + for spaces)", example: "cloudflare+workers" },
            { name: "format", in: "query", required: false, schema: { type: "string", enum: ["json", "text"] }, description: "Response format: json (default) or text" },
          ],
          responses: {
            "200": { description: "Search results (JSON or plain text)" },
            "400": { description: "Missing or invalid query" },
            "429": { description: "Rate limit exceeded (10/hour)" },
            "502": { description: "Search provider failure" },
          },
        },
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
      "/free/fetch": {
        post: {
          tags: ["Free"], summary: "Free Fetch", operationId: "freeFetch",
          description: "Fetch any webpage (content truncated to 2000 chars). Rate limited to 10/hour. No payment required.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["url"], properties: { url: { type: "string" }, timeout: { type: "integer" } } } } } },
          responses: { "200": { description: "Page content (truncated)" }, "400": { description: "Invalid request" }, "429": { description: "Rate limit exceeded" } },
        },
      },
      "/free/search": {
        post: {
          tags: ["Free"], summary: "Free Search", operationId: "freeSearch",
          description: "Web search (max 3 results). Rate limited to 10/hour. No payment required.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["query"], properties: { query: { type: "string" } } } } } },
          responses: { "200": { description: "Search results (max 3)" }, "400": { description: "Invalid request" }, "429": { description: "Rate limit exceeded" } },
        },
      },
      "/intel/company": {
        post: {
          tags: ["Intelligence"], summary: "Company Intelligence", operationId: "intelCompany",
          description: `Comprehensive company deep dive: tech stack, funding, team size, competitors, news. Chains search + batch fetch + AI extraction. Price: ${PRICING.intel.company}`,
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["target"], properties: { target: { type: "string", description: "Company name or domain" } } } } } },
          responses: { "200": { description: "Company profile" }, "402": { $ref: "#/components/responses/PaymentRequired" }, "503": { description: "AI service unavailable" } },
        },
      },
      "/intel/market": {
        post: {
          tags: ["Intelligence"], summary: "Market Research", operationId: "intelMarket",
          description: `AI-powered market research report with executive summary, key findings, trends, and data points. Price: ${PRICING.intel.market}`,
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["topic"], properties: { topic: { type: "string" }, depth: { type: "string", enum: ["quick", "standard", "comprehensive"] }, focus: { type: "string" } } } } } },
          responses: { "200": { description: "Market research report" }, "402": { $ref: "#/components/responses/PaymentRequired" }, "503": { description: "AI service unavailable" } },
        },
      },
      "/intel/competitive": {
        post: {
          tags: ["Intelligence"], summary: "Competitive Analysis", operationId: "intelCompetitive",
          description: `Full competitive analysis: feature matrix, pricing comparison, SWOT analysis, positioning summary. Price: ${PRICING.intel.competitive}`,
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["company"], properties: { company: { type: "string" }, maxCompetitors: { type: "integer", minimum: 1, maximum: 10 }, focus: { type: "string" } } } } } },
          responses: { "200": { description: "Competitive analysis report" }, "402": { $ref: "#/components/responses/PaymentRequired" }, "503": { description: "AI service unavailable" } },
        },
      },
      "/intel/site-audit": {
        post: {
          tags: ["Intelligence"], summary: "Site Audit", operationId: "intelSiteAudit",
          description: `Comprehensive SEO, performance, and security audit with scoring and recommendations. Price: ${PRICING.intel.siteAudit}`,
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["url"], properties: { url: { type: "string" } } } } } },
          responses: { "200": { description: "Site audit report" }, "402": { $ref: "#/components/responses/PaymentRequired" }, "503": { description: "AI service unavailable" } },
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
      "/memory/get": {
        get: {
          tags: ["Memory"], summary: "Get Value", operationId: "memoryGet",
          description: `Retrieve stored value. Requires wallet auth (Payment-Signature or X-CREDIT-WALLET header). Price: ${PRICING.memory.read}`,
          parameters: [{ name: "key", in: "query", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Value retrieved" }, "401": { description: "Unauthorized — wallet auth required" }, "404": { description: "Key not found" } },
        },
      },
      "/memory/delete": {
        delete: {
          tags: ["Memory"], summary: "Delete Value", operationId: "memoryDelete",
          description: "Delete a stored value. Requires wallet auth (Payment-Signature or X-CREDIT-WALLET header).",
          parameters: [{ name: "key", in: "query", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Deleted" }, "401": { description: "Unauthorized — wallet auth required" }, "404": { description: "Key not found" } },
        },
      },
      "/memory/list": {
        get: {
          tags: ["Memory"], summary: "List Keys", operationId: "memoryList",
          description: `List all keys for the authenticated wallet. Requires wallet auth (Payment-Signature or X-CREDIT-WALLET header).`,
          responses: { "200": { description: "Keys list" }, "401": { description: "Unauthorized — wallet auth required" } },
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
          properties: {
            url: { type: "string" },
            title: { type: "string" },
            content: { type: "string" },
            metadata: { type: "object" },
            tier: { type: "string" },
            fetchedAt: { type: "string" },
            cache: { type: "object" },
            proof: { $ref: "#/components/schemas/ProofOfContext" },
            requestId: { type: "string" }
          },
        },
        SearchRequest: { type: "object", required: ["query"], properties: { query: { type: "string" }, limit: { type: "integer" } } },
        SearchResponse: { type: "object", properties: { query: { type: "string" }, results: { type: "array", items: { type: "object" } }, searchedAt: { type: "string" }, requestId: { type: "string" } } },
        ExtractRequest: { type: "object", required: ["url", "schema"], properties: { url: { type: "string" }, schema: { type: "object" }, instructions: { type: "string" } } },
        ExtractResponse: { type: "object", properties: { url: { type: "string" }, data: { type: "object" }, extractedAt: { type: "string" }, proof: { $ref: "#/components/schemas/ProofOfContext" }, requestId: { type: "string" } } },
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
        ProofOfContext: {
          type: "object",
          required: ["hash", "timestamp", "signature", "publicKey"],
          properties: {
            hash: { type: "string", description: "SHA-256 hash of the content" },
            timestamp: { type: "string", description: "ISO timestamp of verification" },
            signature: { type: "string", description: "Cryptographic signature" },
            publicKey: { type: "string", description: "Public key to verify signature" },
          }
        },
      },
      responses: {
        PaymentRequired: {
          description: "Payment required — x402 v2 protocol. Parse the PAYMENT-REQUIRED response header (base64-encoded JSON), sign the payment with your wallet, then retry the request with the Payment-Signature request header.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                description: "Body is empty {} on a 402 — payment requirements are in the PAYMENT-REQUIRED response header.",
              },
            },
          },
          headers: {
            "PAYMENT-REQUIRED": {
              description: "Base64-encoded JSON with the x402 v2 payment requirements: { x402Version: 2, error, resource, accepts: [{ scheme, network, amount, asset, payTo, maxTimeoutSeconds, extra }] }",
              schema: { type: "string" },
            },
            "PAYMENT-RESPONSE": {
              description: "Base64-encoded settlement receipt (txHash, network) — returned on a successful response that delivers a paid resource.",
              schema: { type: "string" },
            },
          },
        },
      },
      securitySchemes: {
        x402Payment: {
          type: "apiKey",
          in: "header",
          name: "Payment-Signature",
          description: "x402 v2 payment payload (base64-encoded signed payment)",
        },
      },
    },
    security: [{ x402Payment: [] }],
  };
}

/**
 * Register OpenAPI documentation routes
 */
export function registerOpenAPIRoutes(app: Hono<{ Bindings: Env; Variables: Variables }>) {
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

## Try It Now (Zero-Friction Reader)

Fetch any webpage as markdown with a single GET request — no auth, no payment, no setup:

  GET https://api.weblens.dev/r/https://example.com
  GET https://api.weblens.dev/s/your+search+query

Add ?format=text for plain output. Rate limited to 10/hour.
Reader: content truncated to 2000 chars. Search: max 3 results.
Upgrade to paid endpoints for full content and more results.

## Quick Start for AI Agents

1. Try the free reader: GET /r/https://example.com (no wallet needed!)
2. For full access, call any paid endpoint (e.g., POST /fetch/basic with {"url": "https://example.com"})
3. Receive 402 Payment Required — read the PAYMENT-REQUIRED response header (base64-encoded JSON) for amount, asset, payTo and accepts
4. Sign USDC payment using your wallet (Base network)
5. Retry with the Payment-Signature header containing the signed payload
6. Receive data; settlement receipt is in the PAYMENT-RESPONSE response header

## Discovery Endpoints

- GET /r/{url} - Zero-friction reader (free, no auth needed)
- GET /s/{query} - Zero-friction search (free, no auth needed)
- GET /discovery - Full service catalog with all endpoints, pricing, and capabilities
- GET /.well-known/x402 - Standard x402 discovery for Bazaar indexing
- GET /mcp/info - MCP server information for AI agent integration

## API Base URL

- Production: https://api.weblens.dev
- Documentation: https://api.weblens.dev/docs
- OpenAPI Spec: https://api.weblens.dev/openapi.json
- Discovery: https://api.weblens.dev/discovery

## Payment Protocol

All paid endpoints use [x402 v2](https://x402.org) micropayments:
1. Make a request to any endpoint
2. Receive \`402 Payment Required\` — payment details are in the \`PAYMENT-REQUIRED\` response header (base64-encoded JSON; body is empty)
3. Sign a USDC payment with your wallet (Base network)
4. Retry the request with the \`Payment-Signature\` header containing the signed payload
5. Receive the response with a \`PAYMENT-RESPONSE\` header (settlement proof)

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

### Intelligence (AI-powered, premium)

These endpoints chain multiple tools and AI synthesis. They're the highest-value services on the platform.

#### POST /intel/company
Comprehensive company deep dive: tech stack, funding, team, competitors, recent news. Chains search + batch fetch + Claude.
- Price: $0.50
- Body: \`{"param": "string", "depth?": "basic"|"deep"}\`
- Returns: \`{"name", "domain", "funding", "summary", "requestId"}\`

#### POST /intel/market
Market research report: executive summary, market size, growth, key trends, key players, recommendations.
- Price: $2.00
- Body: \`{"param": "string", "depth?": "basic"|"deep"}\`
- Returns: \`{"topic", "executiveSummary", "marketSize", "growthRate", "keyTrends", "keyPlayers", "recommendations", "requestId"}\`

#### POST /intel/competitive
Competitive analysis: feature matrix, pricing comparison, SWOT, positioning.
- Price: $3.00
- Body: \`{"param": "string", "depth?": "basic"|"deep"}\`
- Returns: \`{"company", "competitors", "featureMatrix", "pricing", "swot", "positioning", "requestId"}\`

#### POST /intel/site-audit
Full site audit: SEO, performance, security, accessibility scoring with actionable recommendations.
- Price: $0.30
- Body: \`{"param": "string", "depth?": "basic"|"deep"}\`
- Returns: \`{"url", "scores": {"seo", "performance", "security", "accessibility"}, "issues", "recommendations", "requestId"}\`

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

- \`fetch_webpage\` - Fetch webpage as markdown (basic) — $0.005
- \`fetch_webpage_pro\` - Fetch with JS rendering — $0.015
- \`fetch_resilient\` - Resilient fetch with provider fallback — $0.025
- \`screenshot\` - Capture webpage screenshot — $0.02
- \`search_web\` - Real-time web search — $0.005
- \`extract_data\` - Extract structured data with JSON schema — $0.03
- \`smart_extract\` - AI-powered natural-language extraction — $0.035
- \`research\` - Search + fetch + AI summary — $0.08
- \`batch_fetch\` - Fetch multiple URLs in parallel — $0.003/URL
- \`extract_pdf\` - Extract text from PDFs — $0.01
- \`compare_urls\` - Compare 2-3 webpages — $0.05
- \`monitor_create\` - Create URL change monitor — $0.01
- \`memory_set\` - Persistent key-value storage — $0.001
- \`intel_company\` - Company deep dive (AI-powered) — $0.50
- \`intel_market\` - Market research report — $2.00
- \`intel_competitive\` - Competitive analysis — $3.00
- \`intel_site_audit\` - SEO/performance/security audit — $0.30

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
- \`PAYMENT-RESPONSE\` - Settlement proof (on a successful paid response)

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