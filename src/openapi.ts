/**
 * OpenAPI Documentation Configuration
 * Auto-generated API documentation using Scalar
 */

import { Hono } from "hono";
import { Scalar } from "@scalar/hono-api-reference";
import { PRICING } from "./config";
import { getCachedPrice } from "./utils/pricing";
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
          description: "Payment required - use x402 protocol",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  error: { type: "string" },
                  accepts: { type: "array", items: { type: "object" } },
                  x402Version: { type: "integer" },
                },
              },
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

  // LLMs.txt for AI agents
  app.get("/llms.txt", (c) => {
    const doc = getOpenAPIDocument();
    let md = `# ${doc.info.title} v${doc.info.version}\n\n${doc.info.description}\n\n## Endpoints\n\n`;
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, spec] of Object.entries(methods as Record<string, any>)) {
        md += `### ${method.toUpperCase()} ${path}\n${spec.summary}\n${spec.description || ""}\n\n`;
      }
    }
    md += `## Payment\nAll paid endpoints use x402 protocol. Send request, receive 402, sign with wallet, retry with X-PAYMENT header.\n`;
    return c.text(md);
  });
}