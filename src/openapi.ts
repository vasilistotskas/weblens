/**
 * OpenAPI Documentation Configuration
 * Auto-generated API documentation using Scalar
 */

import { Scalar } from "@scalar/hono-api-reference";
import type { Hono } from "hono";
import { PRICING } from "./config";
import { MAX_COMPLEXITY_MULTIPLIER, parsePrice } from "./services/pricing";
import type { Env, Variables } from "./types";

// ---- x402scan discovery helpers (https://www.x402scan.com/discovery/spec) ----
// x-payment-info amounts are decimal USD strings; runtime 402 challenges use
// token atomic units. Both derive from PRICING so they can never drift.

/** "$0.005" → "0.005000" (decimal USD, 6 places). */
function usd(price: string): string {
  return parsePrice(price).toFixed(6);
}

/** x-payment-info for an op whose runtime price never varies. */
function fixedPayment(price: string) {
  return {
    price: { mode: "fixed" as const, currency: "USD", amount: usd(price) },
    protocols: [{ x402: {} }],
  };
}

/** x-payment-info for an op whose runtime price varies (cache discount, complexity, per-URL). */
function dynamicPayment(minUsd: number, maxUsd: number) {
  return {
    price: { mode: "dynamic" as const, currency: "USD", min: minUsd.toFixed(6), max: maxUsd.toFixed(6) },
    protocols: [{ x402: {} }],
  };
}

/** Lowest price after the cache discount (70% off ⇒ 30% of base). */
function cachedMin(price: string): number {
  return parsePrice(price) * (1 - PRICING.cacheDiscount);
}

// OpenAPI Document (exported for the discovery-contract tests)
export function getOpenAPIDocument(baseUrl: string = "https://api.weblens.dev") {
  return {
    openapi: "3.1.0",
    info: {
      title: "WebLens API",
      version: "2.0.0",
      description: `# WebLens - Web Intelligence API, pay per call

Scrape, crawl, map and extract the web. No account, no API key, no monthly
minimum — you pay for the calls you make and nothing else.

## Pricing
Page fetching starts at **${PRICING.fetch.basic}**, whole-site crawling at
**${PRICING.crawl.perPage}/page**, and sitemap discovery at **${PRICING.map}**.
Comparable services bill $0.007-0.008 per request, or reach a lower per-page
rate only on a $99/month commitment. WebLens has no commitment to reach.

## Payment Protocol
All paid endpoints use the [x402 protocol](https://x402.org) for HTTP-native
micropayments (USDC on Base).

## Cache Discount
Cached responses are **70% cheaper** than fresh fetches.`,
      "x-guidance":
        "WebLens is a pay-per-call web intelligence API for AI agents — no accounts, API keys, or monthly minimum. " +
        "Every paid operation is a POST with a JSON body, paid via x402 (USDC on Base): call it, read the " +
        "PAYMENT-REQUIRED response header from the 402, sign, and retry with Payment-Signature. " +
        `Cheapest and most capable at getting pages: POST /fetch/basic {"url": "..."} scrapes to markdown for ${PRICING.fetch.basic}, ` +
        `POST /crawl {"url": "..."} crawls a whole site for ${PRICING.crawl.perPage}/page, and POST /map {"url": "..."} ` +
        `lists a site's URLs from its sitemap for ${PRICING.map}. ` +
        "Use POST /fetch/pro for JavaScript-rendered pages and POST /extract to pull structured JSON from any page. " +
        "Also available: POST /search for web search and POST /research for search + fetch + AI summary. " +
        "Not sure an endpoint is worth its price? POST /preview {\"endpoint\": \"/answer\"} is free and returns the live " +
        "price plus a real sample of the response shape before you pay. " +
        "Free, unauthenticated tries: GET /r/{url} and GET /s/{query} (rate limited).",
      contact: { name: "WebLens Support", url: "https://api.weblens.dev", email: "vassilistotskas@msn.com" },
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
      { name: "Social", description: "Social platform data (YouTube transcripts)" },
      { name: "Extraction", description: "Data extraction endpoints" },
      { name: "Research", description: "AI-powered research tools" },
      { name: "Intelligence", description: "Premium AI-powered intelligence products" },
      { name: "Monitoring", description: "URL change monitoring" },
      { name: "Memory", description: "Persistent key-value storage for agents" },
      { name: "System", description: "Health and documentation endpoints" },
      { name: "Discovery", description: "Free evaluation and ERC-8004 off-chain surfaces — previews, receipts, feedback" },
      { name: "Credits", description: "Prepaid credit system" },
    ],
    paths: {
      "/": { get: { tags: ["System"], summary: "API Info", operationId: "getApiInfo", security: [], responses: { "200": { description: "API info" } } } },
      "/health": { get: { tags: ["System"], summary: "Health Check", operationId: "healthCheck", security: [], responses: { "200": { description: "Health status" } } } },
      "/discovery": {
        get: {
          tags: ["System"],
          summary: "Service Discovery",
          operationId: "getDiscovery",
          security: [],
          description: "Machine-readable service catalog optimized for AI agent discovery. Returns all available endpoints, pricing, capabilities, and integration options.",
          responses: { "200": { description: "Service catalog with endpoints, pricing, and capabilities" } }
        }
      },
      "/.well-known/x402": {
        get: {
          tags: ["System"],
          summary: "x402 Discovery",
          operationId: "getWellKnownX402",
          security: [],
          description: "Standard x402 discovery endpoint. Returns x402-compatible service information for Bazaar indexing.",
          responses: { "200": { description: "x402 service information" } }
        }
      },
      "/r/{url}": {
        get: {
          tags: ["Free"],
          summary: "Reader Mode (Zero-Friction)",
          operationId: "readerFetch",
          security: [],
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
          security: [],
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
          "x-payment-info": fixedPayment(PRICING.screenshot),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ScreenshotRequest" }, example: { url: "https://example.com", fullPage: false } } } },
          responses: { "200": { description: "Screenshot captured", content: { "application/json": { schema: { $ref: "#/components/schemas/ScreenshotResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/fetch/basic": {
        post: {
          tags: ["Core"], summary: "Fetch Page (Basic)", operationId: "fetchBasic",
          description: `Fetch webpage without JS rendering. Price: ${PRICING.fetch.basic} (70% off on cache hits)`,
          "x-payment-info": dynamicPayment(cachedMin(PRICING.fetch.basic), parsePrice(PRICING.fetch.basic)),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/FetchRequest" }, example: { url: "https://example.com" } } } },
          responses: { "200": { description: "Page fetched", content: { "application/json": { schema: { $ref: "#/components/schemas/FetchResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/fetch/pro": {
        post: {
          tags: ["Core"], summary: "Fetch Page (Pro)", operationId: "fetchPro",
          description: `Fetch webpage with full JS rendering. Price: ${PRICING.fetch.pro} base — up to ${MAX_COMPLEXITY_MULTIPLIER}x for high-complexity domains, 70% off on cache hits`,
          "x-payment-info": dynamicPayment(cachedMin(PRICING.fetch.pro), parsePrice(PRICING.fetch.pro) * MAX_COMPLEXITY_MULTIPLIER),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/FetchRequest" }, example: { url: "https://example.com" } } } },
          responses: { "200": { description: "Page fetched", content: { "application/json": { schema: { $ref: "#/components/schemas/FetchResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/search": {
        post: {
          tags: ["Search"], summary: "Web Search", operationId: "searchWeb",
          description: `Real-time web search. Price: ${PRICING.search} base; set includeContent to also fetch the top result pages as markdown in the same call (+${PRICING.contents.perUrl} per fetched result, up to 10)`,
          "x-payment-info": dynamicPayment(parsePrice(PRICING.search), parsePrice(PRICING.search) + 10 * parsePrice(PRICING.contents.perUrl)),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/SearchRequest" }, example: { query: "x402 payment protocol", limit: 10 } } } },
          responses: { "200": { description: "Search results", content: { "application/json": { schema: { $ref: "#/components/schemas/SearchResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/search/news": {
        post: {
          tags: ["Search"], summary: "News Search", operationId: "searchNews",
          description: `Real-time news search via Google News. Returns ranked articles with source, date, and thumbnail. Price: ${PRICING.searchVerticals.news}`,
          "x-payment-info": fixedPayment(PRICING.searchVerticals.news),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/VerticalSearchRequest" }, example: { query: "artificial intelligence", limit: 10 } } } },
          responses: { "200": { description: "News results", content: { "application/json": { schema: { $ref: "#/components/schemas/NewsSearchResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/search/images": {
        post: {
          tags: ["Search"], summary: "Image Search", operationId: "searchImages",
          description: `Google Images search. Returns direct image URLs with dimensions, thumbnails, and source pages. Price: ${PRICING.searchVerticals.images}`,
          "x-payment-info": fixedPayment(PRICING.searchVerticals.images),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/VerticalSearchRequest" }, example: { query: "golden gate bridge", limit: 10 } } } },
          responses: { "200": { description: "Image results", content: { "application/json": { schema: { $ref: "#/components/schemas/ImageSearchResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/search/places": {
        post: {
          tags: ["Search"], summary: "Places Search", operationId: "searchPlaces",
          description: `Local business search via Google Local. Returns names, addresses, ratings, reviews, phone numbers, websites, and coordinates. Price: ${PRICING.searchVerticals.places}`,
          "x-payment-info": fixedPayment(PRICING.searchVerticals.places),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PlacesSearchRequest" }, example: { query: "coffee shops", location: "Austin, Texas", limit: 10 } } } },
          responses: { "200": { description: "Place results", content: { "application/json": { schema: { $ref: "#/components/schemas/PlacesSearchResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/search/shopping": {
        post: {
          tags: ["Search"], summary: "Shopping Search", operationId: "searchShopping",
          description: `Google Shopping product search. Returns products with prices, sellers, ratings, and links. Price: ${PRICING.searchVerticals.shopping}`,
          "x-payment-info": fixedPayment(PRICING.searchVerticals.shopping),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/VerticalSearchRequest" }, example: { query: "mechanical keyboard", limit: 10 } } } },
          responses: { "200": { description: "Product results", content: { "application/json": { schema: { $ref: "#/components/schemas/ShoppingSearchResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/search/scholar": {
        post: {
          tags: ["Search"], summary: "Scholar Search", operationId: "searchScholar",
          description: `Google Scholar academic search. Returns papers with snippets, publication info, and citation counts. Price: ${PRICING.searchVerticals.scholar}`,
          "x-payment-info": fixedPayment(PRICING.searchVerticals.scholar),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/VerticalSearchRequest" }, example: { query: "transformer attention mechanisms", limit: 10 } } } },
          responses: { "200": { description: "Paper results", content: { "application/json": { schema: { $ref: "#/components/schemas/ScholarSearchResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/search/autocomplete": {
        post: {
          tags: ["Search"], summary: "Autocomplete", operationId: "searchAutocomplete",
          description: `Google Autocomplete suggestions for a partial query. Useful for keyword research and intent discovery. Price: ${PRICING.searchVerticals.autocomplete}`,
          "x-payment-info": fixedPayment(PRICING.searchVerticals.autocomplete),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/VerticalSearchRequest" }, example: { query: "how to deploy cloudf", limit: 10 } } } },
          responses: { "200": { description: "Suggestions", content: { "application/json": { schema: { $ref: "#/components/schemas/AutocompleteResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/search/trends": {
        post: {
          tags: ["Search"], summary: "Trends", operationId: "searchTrends",
          description: `Google Trends interest-over-time for a query. Returns a timeline of relative search interest. Price: ${PRICING.searchVerticals.trends}`,
          "x-payment-info": fixedPayment(PRICING.searchVerticals.trends),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/TrendsRequest" }, example: { query: "cloudflare workers" } } } },
          responses: { "200": { description: "Trend timeline", content: { "application/json": { schema: { $ref: "#/components/schemas/TrendsResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/social/youtube/transcript": {
        post: {
          tags: ["Social"], summary: "YouTube Transcript", operationId: "youtubeTranscript",
          description: `Full transcript of any YouTube video with timestamps. Accepts a video ID or any YouTube URL (watch, shorts, youtu.be). Price: ${PRICING.youtubeTranscript}`,
          "x-payment-info": fixedPayment(PRICING.youtubeTranscript),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/YoutubeTranscriptRequest" }, example: { videoId: "dQw4w9WgXcQ" } } } },
          responses: { "200": { description: "Transcript", content: { "application/json": { schema: { $ref: "#/components/schemas/YoutubeTranscriptResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/contents": {
        post: {
          tags: ["Core"], summary: "Bulk Page Contents", operationId: "getContents",
          description: `Cheap bulk page text: fetch ${PRICING.contents.minUrls}-${PRICING.contents.maxUrls} URLs and get clean markdown, truncated to a per-page cap. Price: ${PRICING.contents.perUrl}/URL`,
          "x-payment-info": dynamicPayment(
            parsePrice(PRICING.contents.perUrl) * PRICING.contents.minUrls,
            parsePrice(PRICING.contents.perUrl) * PRICING.contents.maxUrls,
          ),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ContentsRequest" }, example: { urls: ["https://example.com/article"], maxChars: 20000 } } } },
          responses: { "200": { description: "Per-URL contents", content: { "application/json": { schema: { $ref: "#/components/schemas/ContentsResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/answer": {
        post: {
          tags: ["Research"], summary: "Grounded Answer", operationId: "answerQuestion",
          description: `Grounded answer with inline [n] citations: searches the web, fetches sources, and answers strictly from them. Price: ${PRICING.answer}`,
          "x-payment-info": fixedPayment(PRICING.answer),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/AnswerRequest" }, example: { query: "What is the x402 payment protocol?", sources: 3 } } } },
          responses: { "200": { description: "Cited answer", content: { "application/json": { schema: { $ref: "#/components/schemas/AnswerResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/extract": {
        post: {
          tags: ["Extraction"], summary: "Extract Structured Data", operationId: "extractData",
          description: `Extract structured data using JSON schema. Price: ${PRICING.extract} base — up to ${MAX_COMPLEXITY_MULTIPLIER}x for high-complexity domains`,
          "x-payment-info": dynamicPayment(parsePrice(PRICING.extract), parsePrice(PRICING.extract) * MAX_COMPLEXITY_MULTIPLIER),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ExtractRequest" }, example: { url: "https://example.com/product", schema: { name: { type: "string" }, price: { type: "number" } } } } } },
          responses: { "200": { description: "Data extracted", content: { "application/json": { schema: { $ref: "#/components/schemas/ExtractResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/extract/smart": {
        post: {
          tags: ["Extraction"], summary: "Smart Extract", operationId: "smartExtract",
          description: `AI-powered extraction with natural language. Price: ${PRICING.smartExtract}`,
          "x-payment-info": fixedPayment(PRICING.smartExtract),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/SmartExtractRequest" }, example: { url: "https://example.com/contact", query: "find all email addresses" } } } },
          responses: { "200": { description: "Data extracted", content: { "application/json": { schema: { $ref: "#/components/schemas/SmartExtractResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/batch/fetch": {
        post: {
          tags: ["Core"], summary: "Batch Fetch", operationId: "batchFetch",
          description: `Fetch 2-20 URLs in parallel. Price: ${PRICING.batchFetch.perUrl}/URL`,
          "x-payment-info": dynamicPayment(
            parsePrice(PRICING.batchFetch.perUrl) * PRICING.batchFetch.minUrls,
            parsePrice(PRICING.batchFetch.perUrl) * PRICING.batchFetch.maxUrls,
          ),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/BatchFetchRequest" }, example: { urls: ["https://example.com/1", "https://example.com/2"] } } } },
          responses: { "200": { description: "Batch results", content: { "application/json": { schema: { $ref: "#/components/schemas/BatchFetchResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/fetch/resilient": {
        post: {
          tags: ["Core"], summary: "Resilient Fetch (Agent Prime)", operationId: "resilientFetch",
          description: `Resilient fetch with automatic fallback: plain fetch first, then headless Chromium for client-rendered pages and sites that refuse bare HTTP clients. Price: ${PRICING.fetch.resilient} (70% off on cache hits)`,
          "x-payment-info": dynamicPayment(cachedMin(PRICING.fetch.resilient), parsePrice(PRICING.fetch.resilient)),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ResilientFetchRequest" }, example: { url: "https://example.com" } } } },
          responses: { "200": { description: "Fetch results", content: { "application/json": { schema: { $ref: "#/components/schemas/ResilientFetchResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/map": {
        post: {
          tags: ["Core"], summary: "Map Site URLs", operationId: "mapSite",
          description: `Discover a site's URLs without fetching page content: robots.txt Sitemap: directives, then sitemap.xml and nested sitemap indexes, falling back to homepage link extraction. Price: ${PRICING.map}`,
          "x-payment-info": fixedPayment(PRICING.map),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/MapRequest" }, example: { url: "https://example.com", limit: 1000 } } } },
          responses: { "200": { description: "Discovered URLs", content: { "application/json": { schema: { $ref: "#/components/schemas/MapResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/crawl": {
        post: {
          tags: ["Core"], summary: "Crawl Site", operationId: "crawlSite",
          description: `Bounded same-host BFS crawl returning clean markdown for every page in ONE synchronous call — no async job, no polling. robots.txt is honoured by default. Price: ${PRICING.crawl.perPage} per requested page (${String(PRICING.crawl.minPages)}-${String(PRICING.crawl.maxPages)}) — you are charged for the page budget you request (limit), not for the pages actually returned.`,
          "x-payment-info": dynamicPayment(
            parsePrice(PRICING.crawl.perPage) * PRICING.crawl.minPages,
            parsePrice(PRICING.crawl.perPage) * PRICING.crawl.maxPages,
          ),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CrawlRequest" }, example: { url: "https://example.com", limit: 10, maxDepth: 2 } } } },
          responses: {
            "200": { description: "Crawled pages as markdown", content: { "application/json": { schema: { $ref: "#/components/schemas/CrawlResponse" } } } },
            "402": { $ref: "#/components/responses/PaymentRequired" },
            "403": { description: "robots.txt disallows crawling the start URL. Set respectRobots=false only for sites you control.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/dashboard": {
        get: {
          tags: ["System"], summary: "Agent Dashboard", operationId: "getDashboard",
          description: "HTML dashboard for connecting wallet, viewing balance, and transaction history.",
          security: [],
          responses: { "200": { description: "HTML Dashboard" } },
        },
      },
      "/credits/buy": {
        post: {
          tags: ["Credits"], summary: "Buy Credits", operationId: "buyCredits",
          description: "Purchase agent credits with x402. Pay $2-$1000; deposit bonuses: 20% at $10+, 30% at $50+, 40% at $100+.",
          "x-payment-info": dynamicPayment(2, 1000),
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["amount"], properties: { amount: { type: "number", minimum: 2, maximum: 1000, example: 10, description: "Amount in USD to purchase ($2-$1000)" } } }, example: { amount: 10 } } } },
          responses: { "200": { description: "Credits purchased" }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/credits/balance": {
        get: {
          tags: ["Credits"], summary: "Get Balance", operationId: "getCreditsBalance",
          description: "Get current credit balance. Requires X-CREDIT-WALLET and X-CREDIT-SIGNATURE headers.",
          security: [],
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
          security: [],
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
          "x-payment-info": fixedPayment(PRICING.research),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ResearchRequest" }, example: { query: "x402 payment protocol benefits", resultCount: 5 } } } },
          responses: { "200": { description: "Research results", content: { "application/json": { schema: { $ref: "#/components/schemas/ResearchResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/research/deep": {
        post: {
          tags: ["Research"], summary: "Deep Research (Cited)", operationId: "deepResearch",
          description: `Multi-step cited research in ONE synchronous call — no async job, no polling. Plans sub-questions from your query, runs a web search per sub-question, fetches and dedupes the sources across them, then synthesizes an answer with inline [n] citations, key findings, and gaps. Price: ${PRICING.deepResearch.standard} standard (3 sub-questions, 8 sources) / ${PRICING.deepResearch.deep} deep (5 sub-questions, 12 sources). LATENCY: this is a long-running call — a standard run typically takes 30-60 seconds and deep takes longer, so set a generous HTTP client timeout (120s recommended). Differs from POST /research (${PRICING.research}, a single search + AI summary) by decomposing the question into sub-questions and citing every claim inline.`,
          "x-payment-info": dynamicPayment(parsePrice(PRICING.deepResearch.standard), parsePrice(PRICING.deepResearch.deep)),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/DeepResearchRequest" }, example: { query: "How are AI agents using micropayments in 2026?", depth: "standard" } } } },
          responses: {
            "200": { description: "Cited research report", content: { "application/json": { schema: { $ref: "#/components/schemas/DeepResearchResponse" } } } },
            "402": { $ref: "#/components/responses/PaymentRequired" },
            "404": { description: "No web sources found for this query — nothing was charged for a failed run.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "502": { description: "Research failed or timed out before completing.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "503": { description: "AI service unavailable", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/pdf": {
        post: {
          tags: ["Extraction"], summary: "Extract PDF", operationId: "extractPdf",
          description: `Extract text from PDF documents. Price: ${PRICING.pdf}`,
          "x-payment-info": fixedPayment(PRICING.pdf),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PdfExtractRequest" }, example: { url: "https://example.com/document.pdf" } } } },
          responses: { "200": { description: "PDF extracted", content: { "application/json": { schema: { $ref: "#/components/schemas/PdfExtractResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/compare": {
        post: {
          tags: ["Research"], summary: "Compare URLs", operationId: "compareUrls",
          description: `Compare 2-3 URLs with AI analysis. Price: ${PRICING.compare}`,
          "x-payment-info": fixedPayment(PRICING.compare),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CompareRequest" }, example: { urls: ["https://product-a.com", "https://product-b.com"] } } } },
          responses: { "200": { description: "Comparison results", content: { "application/json": { schema: { $ref: "#/components/schemas/CompareResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/monitor/create": {
        post: {
          tags: ["Monitoring"], summary: "Create Monitor", operationId: "createMonitor",
          description: `Create URL change monitor. Price: ${PRICING.monitor.setup}`,
          "x-payment-info": fixedPayment(PRICING.monitor.setup),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/MonitorCreateRequest" }, example: { url: "https://example.com/status", webhookUrl: "https://your-app.com/webhook" } } } },
          responses: { "200": { description: "Monitor created", content: { "application/json": { schema: { $ref: "#/components/schemas/MonitorCreateResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/monitor/{id}": {
        get: {
          tags: ["Monitoring"], summary: "Get Monitor", operationId: "getMonitor",
          security: [],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Monitor status" }, "404": { description: "Not found" } },
        },
        delete: {
          tags: ["Monitoring"], summary: "Delete Monitor", operationId: "deleteMonitor",
          security: [],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Deleted" }, "404": { description: "Not found" } },
        },
      },
      "/free/fetch": {
        post: {
          tags: ["Free"], summary: "Free Fetch", operationId: "freeFetch",
          description: "Fetch any webpage (content truncated to 2000 chars). Rate limited to 10/hour. No payment required.",
          security: [],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["url"], properties: { url: { type: "string" }, timeout: { type: "integer" } } } } } },
          responses: { "200": { description: "Page content (truncated)" }, "400": { description: "Invalid request" }, "429": { description: "Rate limit exceeded" } },
        },
      },
      "/free/search": {
        post: {
          tags: ["Free"], summary: "Free Search", operationId: "freeSearch",
          description: "Web search (max 3 results). Rate limited to 10/hour. No payment required.",
          security: [],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["query"], properties: { query: { type: "string" } } } } } },
          responses: { "200": { description: "Search results (max 3)" }, "400": { description: "Invalid request" }, "429": { description: "Rate limit exceeded" } },
        },
      },
      "/preview": {
        post: {
          tags: ["Discovery"], summary: "Preview a Paid Endpoint", operationId: "previewEndpoint",
          security: [],
          description: "See what a paid endpoint costs and what it returns BEFORE paying. Free, rate limited to 10/hour per IP. Returns the live price (derived from the same PRICING source as the 402 challenge), a one-line summary, and a recorded sample of the exact response shape. A real, truncated LIVE preview runs only for endpoints whose marginal cost is a plain fetch (currently /fetch/basic, /contents, /map) and only when you pass a url; endpoints backed by a metered upstream (SerpAPI, Anthropic) never run live for free and return the recorded sample instead. Responds 404 for an endpoint that is not sold.",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PreviewRequest" }, example: { endpoint: "/answer" } } } },
          responses: {
            "200": { description: "Price, summary, recorded sample and (when available) a live truncated preview", content: { "application/json": { schema: { $ref: "#/components/schemas/PreviewResponse" } } } },
            "400": { description: "Invalid body, or an unsafe/malformed url", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "404": { description: "Unknown endpoint — it is not one of the paid endpoints. See /discovery for the catalogue.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "429": { description: "Rate limit exceeded (10/hour)" },
          },
        },
      },
      "/.well-known/agent-registration.json": {
        get: {
          tags: ["Discovery"], summary: "ERC-8004 Registration Document", operationId: "getAgentRegistration",
          security: [],
          description: "ERC-8004 (Trustless Agents) registration document: name, description, image, services, x402 support, payment info, and the feedback endpoints. WebLens hosts only the OFF-CHAIN half of ERC-8004 — it is not registered on-chain, holds no agent id, and writes nothing to any registry, so `registrations` stays empty until someone registers this URI on an Identity Registry. `supportedTrust` is [\"feedback\"]: no crypto-economic or TEE-attestation claims are made.",
          responses: { "200": { description: "Registration document", content: { "application/json": { schema: { $ref: "#/components/schemas/AgentRegistration" } } } } },
        },
      },
      "/receipts/{requestId}": {
        get: {
          tags: ["Discovery"], summary: "Get Call Receipt", operationId: "getReceipt",
          security: [],
          description: "Receipt for a paid call — endpoint, status, outcome, charged price, payment method, network and pay-to address. Every paid response carries `X-Receipt-Id` and `X-Receipt-Url` headers pointing here. Receipts are kept for 30 days. When signing is configured the receipt also carries `mac`/`keyId`/`alg`: a symmetric HMAC tag (the same construction as proof-of-context) that only a key holder can verify — it is NOT a third-party-verifiable signature.",
          parameters: [{ name: "requestId", in: "path", required: true, schema: { type: "string" }, description: "The X-Request-Id / X-Receipt-Id of the paid call" }],
          responses: {
            "200": { description: "Receipt for the call", content: { "application/json": { schema: { $ref: "#/components/schemas/CallReceipt" } } } },
            "404": { description: "No receipt for that request id (receipts are issued for paid calls and kept 30 days)", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/feedback": {
        post: {
          tags: ["Discovery"], summary: "Host an ERC-8004 Feedback Document", operationId: "submitFeedback",
          security: [],
          description: "Host a buyer-authored ERC-8004 feedback document and get back the (feedbackURI, feedbackHash) pair that `giveFeedback()` on a Reputation Registry expects. The document is stored verbatim and served back byte-for-byte from GET /feedback/{id}, so its keccak-256 hash matches the hash returned here. WebLens neither authors nor alters the document and never calls the registry — the buyer posts giveFeedback() themselves. Free, rate limited to 10/hour per IP. Limits: body ≤ 256KB, nesting ≤ 32 levels.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/FeedbackDocument" },
                example: {
                  agentRegistry: "eip155:8453:0x0000000000000000000000000000000000000000",
                  agentId: "42",
                  clientAddress: "0x1234567890abcdef1234567890abcdef12345678",
                  createdAt: "2026-07-31T12:00:00.000Z",
                  value: 95,
                  valueDecimals: 0,
                  tag1: "quality",
                  endpoint: "/answer",
                },
              },
            },
          },
          responses: {
            "201": { description: "Document hosted; use feedbackURI + feedbackHash in giveFeedback()", content: { "application/json": { schema: { $ref: "#/components/schemas/FeedbackHosted" } } } },
            "400": { description: "Body is not a JSON object, nests deeper than 32 levels, or is missing required ERC-8004 fields (the response names them)", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "413": { description: "Body exceeds the 256KB limit", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "429": { description: "Rate limit exceeded (10/hour)" },
          },
        },
      },
      "/feedback/{id}": {
        get: {
          tags: ["Discovery"], summary: "Get a Hosted Feedback Document", operationId: "getFeedbackDocument",
          security: [],
          description: "Serves a hosted feedback document verbatim — the bytes are exactly what was hashed, so keccak-256 of this response equals the feedbackHash returned by POST /feedback. This URL is the feedbackURI.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, description: "Id from the feedbackURI returned by POST /feedback" }],
          responses: {
            "200": { description: "The stored document, byte-for-byte", content: { "application/json": { schema: { $ref: "#/components/schemas/FeedbackDocument" } } } },
            "404": { description: "No feedback document with that id", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/intel/company": {
        post: {
          tags: ["Intelligence"], summary: "Company Intelligence", operationId: "intelCompany",
          description: `Comprehensive company deep dive: tech stack, funding, team size, competitors, news. Chains search + batch fetch + AI extraction. Price: ${PRICING.intel.company}`,
          "x-payment-info": fixedPayment(PRICING.intel.company),
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["target"], properties: { target: { type: "string", description: "Company name or domain" } } }, example: { target: "coinbase.com" } } } },
          responses: { "200": { description: "Company profile" }, "402": { $ref: "#/components/responses/PaymentRequired" }, "503": { description: "AI service unavailable" } },
        },
      },
      "/intel/market": {
        post: {
          tags: ["Intelligence"], summary: "Market Research", operationId: "intelMarket",
          description: `AI-powered market research report with executive summary, key findings, trends, and data points. Price: ${PRICING.intel.market}`,
          "x-payment-info": fixedPayment(PRICING.intel.market),
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["topic"], properties: { topic: { type: "string" }, depth: { type: "string", enum: ["quick", "standard", "comprehensive"] }, focus: { type: "string" } } }, example: { topic: "AI Agents", depth: "standard" } } } },
          responses: { "200": { description: "Market research report" }, "402": { $ref: "#/components/responses/PaymentRequired" }, "503": { description: "AI service unavailable" } },
        },
      },
      "/intel/competitive": {
        post: {
          tags: ["Intelligence"], summary: "Competitive Analysis", operationId: "intelCompetitive",
          description: `Full competitive analysis: feature matrix, pricing comparison, SWOT analysis, positioning summary. Price: ${PRICING.intel.competitive}`,
          "x-payment-info": fixedPayment(PRICING.intel.competitive),
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["company"], properties: { company: { type: "string" }, maxCompetitors: { type: "integer", minimum: 1, maximum: 10 }, focus: { type: "string" } } }, example: { company: "Example Corp", maxCompetitors: 5 } } } },
          responses: { "200": { description: "Competitive analysis report" }, "402": { $ref: "#/components/responses/PaymentRequired" }, "503": { description: "AI service unavailable" } },
        },
      },
      "/intel/site-audit": {
        post: {
          tags: ["Intelligence"], summary: "Site Audit", operationId: "intelSiteAudit",
          description: `Comprehensive SEO, performance, and security audit with scoring and recommendations. Price: ${PRICING.intel.siteAudit}`,
          "x-payment-info": fixedPayment(PRICING.intel.siteAudit),
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["url"], properties: { url: { type: "string", format: "uri", example: "https://example.com" } } }, example: { url: "https://example.com" } } } },
          responses: { "200": { description: "Site audit report" }, "402": { $ref: "#/components/responses/PaymentRequired" }, "503": { description: "AI service unavailable" } },
        },
      },
      "/memory/set": {
        post: {
          tags: ["Memory"], summary: "Store Value", operationId: "memorySet",
          description: `Store in key-value storage. Price: ${PRICING.memory.write}`,
          "x-payment-info": fixedPayment(PRICING.memory.write),
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/MemorySetRequest" }, example: { key: "user_prefs", value: { theme: "dark" } } } } },
          responses: { "200": { description: "Stored", content: { "application/json": { schema: { $ref: "#/components/schemas/MemorySetResponse" } } } }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/memory/get": {
        get: {
          tags: ["Memory"], summary: "Get Value", operationId: "memoryGet",
          description: `Retrieve stored value. Requires wallet auth (Payment-Signature or X-CREDIT-WALLET header). Price: ${PRICING.memory.read}`,
          security: [],
          parameters: [{ name: "key", in: "query", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Value retrieved" }, "401": { description: "Unauthorized — wallet auth required" }, "404": { description: "Key not found" } },
        },
      },
      "/memory/delete": {
        delete: {
          tags: ["Memory"], summary: "Delete Value", operationId: "memoryDelete",
          description: "Delete a stored value. Requires wallet auth (Payment-Signature or X-CREDIT-WALLET header).",
          security: [],
          parameters: [{ name: "key", in: "query", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Deleted" }, "401": { description: "Unauthorized — wallet auth required" }, "404": { description: "Key not found" } },
        },
      },
      "/memory/list": {
        get: {
          tags: ["Memory"], summary: "List Keys", operationId: "memoryList",
          description: `List all keys for the authenticated wallet. Requires wallet auth (Payment-Signature or X-CREDIT-WALLET header).`,
          security: [],
          responses: { "200": { description: "Keys list" }, "401": { description: "Unauthorized — wallet auth required" } },
        },
      },
      "/mcp": {
        post: {
          tags: ["System"], summary: "MCP JSON-RPC", operationId: "mcpPost",
          description: "Model Context Protocol endpoint for AI agents. Supports tools/list and tools/call methods.",
          security: [],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { jsonrpc: { type: "string" }, method: { type: "string" }, params: { type: "object" }, id: { type: "string" } } } } } },
          responses: { "200": { description: "JSON-RPC response" }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/mcp/info": {
        get: {
          tags: ["System"], summary: "MCP Server Info", operationId: "mcpInfo",
          description: "Get MCP server information including available tools and pricing.",
          security: [],
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
          properties: { url: { type: "string", format: "uri", example: "https://example.com/article" }, timeout: { type: "integer" }, cache: { type: "boolean" }, cacheTtl: { type: "integer" }, waitFor: { type: "string" } },
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
        SearchRequest: {
          type: "object", required: ["query"],
          properties: {
            query: { type: "string" },
            limit: { type: "integer" },
            includeContent: { type: "boolean", description: `Also fetch the top result pages as markdown (+${PRICING.contents.perUrl} per fetched result)` },
            contentResults: { type: "integer", minimum: 1, maximum: 10, description: "How many top results to fetch content for (default 5)" },
            contentChars: { type: "integer", minimum: 500, maximum: 20000, description: "Per-page content character cap (default 8000)" },
          },
        },
        SearchResponse: { type: "object", properties: { query: { type: "string" }, results: { type: "array", items: { type: "object" } }, searchedAt: { type: "string" }, requestId: { type: "string" } } },
        VerticalSearchRequest: { type: "object", required: ["query"], properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } } },
        NewsSearchResponse: { type: "object", properties: { query: { type: "string" }, results: { type: "array", items: { type: "object", properties: { position: { type: "integer" }, title: { type: "string" }, url: { type: "string" }, source: { type: "string" }, date: { type: "string" }, isoDate: { type: "string" }, thumbnail: { type: "string" } } } }, searchedAt: { type: "string" }, requestId: { type: "string" } } },
        ImageSearchResponse: { type: "object", properties: { query: { type: "string" }, results: { type: "array", items: { type: "object", properties: { position: { type: "integer" }, title: { type: "string" }, imageUrl: { type: "string" }, thumbnail: { type: "string" }, sourcePage: { type: "string" }, source: { type: "string" }, width: { type: "integer" }, height: { type: "integer" } } } }, searchedAt: { type: "string" }, requestId: { type: "string" } } },
        PlacesSearchRequest: { type: "object", required: ["query"], properties: { query: { type: "string" }, location: { type: "string", description: "Free-text location bias, e.g. \"Austin, Texas\"" }, limit: { type: "integer", minimum: 1, maximum: 20 } } },
        PlacesSearchResponse: { type: "object", properties: { query: { type: "string" }, results: { type: "array", items: { type: "object", properties: { position: { type: "integer" }, name: { type: "string" }, address: { type: "string" }, rating: { type: "number" }, reviews: { type: "integer" }, priceLevel: { type: "string" }, category: { type: "string" }, phone: { type: "string" }, website: { type: "string" }, description: { type: "string" }, placeId: { type: "string" }, coordinates: { type: "object" } } } }, searchedAt: { type: "string" }, requestId: { type: "string" } } },
        ShoppingSearchResponse: { type: "object", properties: { query: { type: "string" }, results: { type: "array", items: { type: "object", properties: { position: { type: "integer" }, title: { type: "string" }, url: { type: "string" }, price: { type: "string" }, extractedPrice: { type: "number" }, source: { type: "string" }, rating: { type: "number" }, reviews: { type: "integer" }, thumbnail: { type: "string" } } } }, searchedAt: { type: "string" }, requestId: { type: "string" } } },
        ScholarSearchResponse: { type: "object", properties: { query: { type: "string" }, results: { type: "array", items: { type: "object", properties: { position: { type: "integer" }, title: { type: "string" }, url: { type: "string" }, snippet: { type: "string" }, publicationInfo: { type: "string" }, citedBy: { type: "integer" } } } }, searchedAt: { type: "string" }, requestId: { type: "string" } } },
        AutocompleteResponse: { type: "object", properties: { query: { type: "string" }, suggestions: { type: "array", items: { type: "string" } }, searchedAt: { type: "string" }, requestId: { type: "string" } } },
        TrendsRequest: { type: "object", required: ["query"], properties: { query: { type: "string", description: "Topic to get trend data for" } } },
        TrendsResponse: { type: "object", properties: { query: { type: "string" }, timeline: { type: "array", items: { type: "object", properties: { date: { type: "string" }, timestamp: { type: "string" }, values: { type: "array", items: { type: "object" } } } } }, searchedAt: { type: "string" }, requestId: { type: "string" } } },
        YoutubeTranscriptRequest: { type: "object", required: ["videoId"], properties: { videoId: { type: "string", example: "dQw4w9WgXcQ", description: "YouTube video ID (e.g. dQw4w9WgXcQ) or full video URL (watch, shorts, youtu.be)" }, lang: { type: "string", description: "Transcript language code (default: video default)" } } },
        YoutubeTranscriptResponse: { type: "object", properties: { videoId: { type: "string" }, language: { type: "string" }, segments: { type: "array", items: { type: "object", properties: { startMs: { type: "integer" }, startTime: { type: "string" }, text: { type: "string" } } } }, fullText: { type: "string" }, fetchedAt: { type: "string" }, requestId: { type: "string" } } },
        ContentsRequest: { type: "object", required: ["urls"], properties: { urls: { type: "array", items: { type: "string", format: "uri" }, minItems: 1, maxItems: 20, example: ["https://example.com/article"] }, maxChars: { type: "integer", minimum: 500, maximum: 50000, description: "Per-page content character cap (default 20000)" }, timeout: { type: "integer", minimum: 5000, maximum: 30000 } } },
        ContentsResponse: { type: "object", properties: { results: { type: "array", items: { type: "object", properties: { url: { type: "string" }, status: { type: "string" }, title: { type: "string" }, content: { type: "string" }, truncated: { type: "boolean" }, error: { type: "string" } } } }, summary: { type: "object", properties: { total: { type: "integer" }, successful: { type: "integer" }, failed: { type: "integer" } } }, fetchedAt: { type: "string" }, requestId: { type: "string" } } },
        AnswerRequest: { type: "object", required: ["query"], properties: { query: { type: "string", description: "The question to answer" }, sources: { type: "integer", minimum: 1, maximum: 5, description: "Web sources to search, fetch, and cite (default 3)" } } },
        AnswerResponse: { type: "object", properties: { query: { type: "string" }, answer: { type: "string", description: "Answer text with inline [n] citation markers" }, citations: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, url: { type: "string" }, title: { type: "string" } } } }, confidence: { type: "number" }, answeredAt: { type: "string" }, requestId: { type: "string" } } },
        ExtractRequest: { type: "object", required: ["url", "schema"], properties: { url: { type: "string", format: "uri", example: "https://example.com/product" }, schema: { type: "object", example: { name: { type: "string" }, price: { type: "number" } } }, instructions: { type: "string" } } },
        ExtractResponse: { type: "object", properties: { url: { type: "string" }, data: { type: "object" }, extractedAt: { type: "string" }, proof: { $ref: "#/components/schemas/ProofOfContext" }, requestId: { type: "string" } } },
        SmartExtractRequest: { type: "object", required: ["url", "query"], properties: { url: { type: "string", format: "uri", example: "https://example.com/contact" }, query: { type: "string", example: "find all email addresses" }, format: { type: "string" } } },
        SmartExtractResponse: { type: "object", properties: { url: { type: "string" }, query: { type: "string" }, data: { type: "array" }, explanation: { type: "string" }, extractedAt: { type: "string" }, requestId: { type: "string" } } },
        BatchFetchRequest: { type: "object", required: ["urls"], properties: { urls: { type: "array", items: { type: "string", format: "uri" }, minItems: 2, maxItems: 20, example: ["https://example.com/1", "https://example.com/2"] }, timeout: { type: "integer" }, tier: { type: "string" } } },
        BatchFetchResponse: { type: "object", properties: { results: { type: "array" }, summary: { type: "object" }, totalPrice: { type: "string" }, requestId: { type: "string" } } },
        ResilientFetchRequest: { type: "object", required: ["url"], properties: { url: { type: "string", format: "uri", example: "https://example.com" }, timeout: { type: "integer" } } },
        ResilientFetchResponse: { type: "object", properties: { url: { type: "string" }, title: { type: "string" }, content: { type: "string" }, provider: { type: "object" }, tier: { type: "string" }, fetchedAt: { type: "string" }, requestId: { type: "string" } } },
        MapRequest: {
          type: "object", required: ["url"],
          properties: {
            url: { type: "string", format: "uri", example: "https://example.com", description: "Site URL to map — the origin is used for robots.txt and sitemap lookups" },
            limit: { type: "integer", minimum: 1, maximum: 5000, description: "Maximum URLs to return (default 1000)" },
            include: { type: "array", items: { type: "string" }, description: "Only URLs whose path+query contains one of these substrings" },
            exclude: { type: "array", items: { type: "string" }, description: "Skip URLs whose path+query contains one of these substrings" },
            timeout: { type: "integer", minimum: 5000, maximum: 30000 },
          },
        },
        MapResponse: {
          type: "object",
          properties: {
            url: { type: "string" },
            urls: { type: "array", items: { type: "string" }, description: "Discovered same-host URLs" },
            total: { type: "integer" },
            source: { type: "string", enum: ["sitemap", "links", "none"], description: "Where the URLs came from" },
            sitemapsChecked: { type: "integer", description: "Sitemap documents fetched (including nested indexes)" },
            mappedAt: { type: "string" },
            requestId: { type: "string" },
          },
        },
        CrawlRequest: {
          type: "object", required: ["url"],
          properties: {
            url: { type: "string", format: "uri", example: "https://example.com", description: "Start URL — the crawl stays on this host" },
            limit: { type: "integer", minimum: PRICING.crawl.minPages, maximum: PRICING.crawl.maxPages, description: `Page budget (default 10) — you are charged ${PRICING.crawl.perPage} per requested page, not per page returned` },
            maxDepth: { type: "integer", minimum: 0, maximum: 3, description: "Link depth from the start URL (0 = start page only, default 2)" },
            include: { type: "array", items: { type: "string" }, description: "Only crawl URLs whose path+query contains one of these substrings" },
            exclude: { type: "array", items: { type: "string" }, description: "Skip URLs whose path+query contains one of these substrings" },
            respectRobots: { type: "boolean", description: "Honour robots.txt (default true; disable only for sites you control)" },
            maxChars: { type: "integer", minimum: 500, maximum: 50000, description: "Per-page content character cap (default 8000)" },
            timeout: { type: "integer", minimum: 5000, maximum: 30000 },
          },
        },
        CrawlResponse: {
          type: "object",
          properties: {
            url: { type: "string" },
            pages: { type: "array", items: { type: "object", properties: { url: { type: "string" }, depth: { type: "integer" }, status: { type: "string", enum: ["success", "failed"] }, title: { type: "string" }, content: { type: "string", description: "Page as clean markdown" }, truncated: { type: "boolean" }, error: { type: "string" } } } },
            summary: { type: "object", properties: { crawled: { type: "integer" }, successful: { type: "integer" }, failed: { type: "integer" }, discovered: { type: "integer" }, limit: { type: "integer" }, maxDepth: { type: "integer" }, robotsRespected: { type: "boolean" } } },
            crawledAt: { type: "string" },
            requestId: { type: "string" },
          },
        },
        ResearchRequest: { type: "object", required: ["query"], properties: { query: { type: "string" }, resultCount: { type: "integer" }, includeRawContent: { type: "boolean" } } },
        ResearchResponse: { type: "object", properties: { query: { type: "string" }, sources: { type: "array" }, summary: { type: "string" }, keyFindings: { type: "array" }, researchedAt: { type: "string" }, requestId: { type: "string" } } },
        DeepResearchRequest: {
          type: "object", required: ["query"],
          properties: {
            query: { type: "string", minLength: 1, maxLength: 500, example: "How are AI agents using micropayments in 2026?", description: "The research question (1-500 chars)" },
            depth: { type: "string", enum: ["standard", "deep"], description: `Research tier: standard = 3 sub-questions / 8 sources (${PRICING.deepResearch.standard}); deep = 5 sub-questions / 12 sources (${PRICING.deepResearch.deep}). Default: standard.` },
          },
        },
        DeepResearchResponse: {
          type: "object",
          properties: {
            query: { type: "string" },
            depth: { type: "string", enum: ["standard", "deep"] },
            subQuestions: { type: "array", items: { type: "string" }, description: "The sub-questions the query was decomposed into, one web search each" },
            answer: { type: "string", description: "Synthesized answer with inline [n] citation markers" },
            keyFindings: { type: "array", items: { type: "string" }, description: "Bullet-point findings drawn from the sources" },
            citations: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, url: { type: "string" }, title: { type: "string" }, subQuestion: { type: "string" } } }, description: "Sources behind the [n] markers, with the sub-question each answered" },
            gaps: { type: "array", items: { type: "string" }, description: "What the sources did not establish" },
            sourcesFetched: { type: "integer", description: "Sources whose full page was fetched (the rest fall back to their search snippet)" },
            researchedAt: { type: "string" },
            requestId: { type: "string" },
          },
        },
        PdfExtractRequest: { type: "object", required: ["url"], properties: { url: { type: "string", format: "uri", example: "https://example.com/document.pdf" }, pages: { type: "array", items: { type: "integer" } } } },
        PdfExtractResponse: { type: "object", properties: { url: { type: "string" }, metadata: { type: "object" }, pages: { type: "array" }, fullText: { type: "string" }, extractedAt: { type: "string" }, requestId: { type: "string" } } },
        CompareRequest: { type: "object", required: ["urls"], properties: { urls: { type: "array", items: { type: "string", format: "uri" }, minItems: 2, maxItems: 3, example: ["https://product-a.com", "https://product-b.com"] }, focus: { type: "string" } } },
        CompareResponse: { type: "object", properties: { sources: { type: "array" }, comparison: { type: "object" }, comparedAt: { type: "string" }, requestId: { type: "string" } } },
        MonitorCreateRequest: { type: "object", required: ["url", "webhookUrl"], properties: { url: { type: "string", format: "uri", example: "https://example.com/status" }, webhookUrl: { type: "string", format: "uri", example: "https://your-app.com/webhook" }, checkInterval: { type: "integer" }, notifyOn: { type: "string" } } },
        MonitorCreateResponse: { type: "object", properties: { monitorId: { type: "string" }, url: { type: "string" }, webhookUrl: { type: "string" }, checkInterval: { type: "integer" }, nextCheckAt: { type: "string" }, createdAt: { type: "string" }, requestId: { type: "string" } } },
        MemorySetRequest: { type: "object", required: ["key", "value"], properties: { key: { type: "string" }, value: {}, ttl: { type: "integer" } } },
        MemorySetResponse: { type: "object", properties: { key: { type: "string" }, stored: { type: "boolean" }, expiresAt: { type: "string" }, requestId: { type: "string" } } },
        ErrorResponse: { type: "object", properties: { error: { type: "string" }, code: { type: "string" }, message: { type: "string" }, requestId: { type: "string" } } },
        PreviewRequest: {
          type: "object", required: ["endpoint"],
          properties: {
            endpoint: { type: "string", minLength: 1, maxLength: 100, example: "/answer", description: "Paid endpoint path to preview, e.g. \"/answer\" (a leading slash is added if you omit it)" },
            url: { type: "string", format: "uri", example: "https://example.com", description: "Fetch-backed endpoints only (/fetch/basic, /contents, /map): run a real truncated preview of this URL" },
          },
        },
        PreviewResponse: {
          type: "object",
          properties: {
            endpoint: { type: "string" },
            method: { type: "string" },
            price: { type: "string", description: "Human-readable price, resolved from the same PRICING source as the 402 challenge" },
            currency: { type: "string" },
            summary: { type: "string", description: "One line on what the paid call returns" },
            sample: { type: "object", description: "Recorded example of the real response shape" },
            sampleType: { type: "string", enum: ["recorded"] },
            live: { type: "object", description: "Present only when a live preview ran: { url, title, content, truncatedAt, note } — or { error } if the fetch failed" },
            livePreviewAvailable: { type: "boolean", description: "True only for endpoints with no paid upstream (currently /fetch/basic, /contents, /map)" },
            livePreviewHint: { type: "string" },
            docs: { type: "string" },
            schema: { type: "string", description: "URL of the OpenAPI document" },
            previewedAt: { type: "string" },
            requestId: { type: "string" },
          },
        },
        AgentRegistration: {
          type: "object",
          properties: {
            type: { type: "string", description: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1" },
            name: { type: "string" },
            description: { type: "string" },
            image: { type: "string" },
            active: { type: "boolean" },
            x402Support: { type: "boolean" },
            services: { type: "array", items: { type: "object", properties: { name: { type: "string" }, endpoint: { type: "string" }, version: { type: "string" } } } },
            registrations: { type: "array", items: { type: "object", properties: { agentId: { type: "string" }, agentRegistry: { type: "string" } } }, description: "Empty: WebLens is not registered on-chain and holds no agent id" },
            supportedTrust: { type: "array", items: { type: "string" }, description: "[\"feedback\"] — the only trust model actually supported today" },
            payment: { type: "object", properties: { protocol: { type: "string" }, version: { type: "integer" }, networks: { type: "array", items: { type: "string" } }, asset: { type: "string" }, priceRange: { type: "string" } } },
            feedback: { type: "object", properties: { receiptEndpoint: { type: "string" }, submitEndpoint: { type: "string" }, hashAlgorithm: { type: "string" } } },
          },
        },
        CallReceipt: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["weblens-call-receipt-v1"] },
            requestId: { type: "string" },
            endpoint: { type: "string" },
            method: { type: "string" },
            status: { type: "integer", description: "HTTP status the caller received" },
            outcome: { type: "string", enum: ["success", "error"] },
            price: { type: "string", description: "Charged price, e.g. \"$0.015\". Absent when the call was not charged." },
            currency: { type: "string", enum: ["USD"] },
            paymentMethod: { type: "string", description: "\"x402\" or \"credits\"" },
            network: { type: "string" },
            payTo: { type: "string" },
            servedAt: { type: "string" },
            mac: { type: "string", description: "Symmetric HMAC tag over the receipt — verifiable only by the key holder, NOT a third-party-verifiable signature" },
            keyId: { type: "string" },
            alg: { type: "string" },
          },
        },
        FeedbackDocument: {
          type: "object",
          required: ["agentRegistry", "agentId", "clientAddress", "createdAt", "value", "valueDecimals"],
          description: "Buyer-authored ERC-8004 feedback document. Extra fields are preserved verbatim.",
          properties: {
            agentRegistry: { type: "string", description: "CAIP-10 style address of the Identity Registry the agentId belongs to" },
            agentId: { type: "string" },
            clientAddress: { type: "string", description: "Wallet posting giveFeedback()" },
            createdAt: { type: "string" },
            value: { type: "number", description: "Score, scaled by valueDecimals" },
            valueDecimals: { type: "integer" },
            tag1: { type: "string" },
            tag2: { type: "string" },
            endpoint: { type: "string", description: "WebLens endpoint the feedback is about" },
            proofOfPayment: { type: "string", description: "e.g. the X-Receipt-Url of the paid call" },
          },
        },
        FeedbackHosted: {
          type: "object",
          properties: {
            feedbackURI: { type: "string", description: "Pass to giveFeedback() — GET it to retrieve the exact bytes that were hashed" },
            feedbackHash: { type: "string", description: "keccak-256 of the canonical document bytes" },
            storedAt: { type: "string" },
            hashAlgorithm: { type: "string", enum: ["keccak256"] },
            note: { type: "string" },
            requestId: { type: "string" },
          },
        },
        ProofOfContext: {
          type: "object",
          required: ["hash", "timestamp", "alg", "mac", "keyId"],
          properties: {
            hash: { type: "string", description: "SHA-256 hash of the content" },
            timestamp: { type: "string", description: "ISO timestamp of verification" },
            alg: { type: "string", description: "MAC algorithm (e.g. HMAC-SHA256)" },
            mac: { type: "string", description: "Symmetric HMAC tag over {url, hash, timestamp} — not third-party verifiable" },
            keyId: { type: "string", description: "Identifier of the oracle key that produced the MAC" },
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
      favicon: "/favicon.svg",
    })
  );

  // LLMs.txt for AI agents - comprehensive API documentation
  app.get("/llms.txt", (c) => {
    const llmsTxt = `# WebLens

> Scrape, crawl, map and extract the web. Pay per call, no account, no monthly minimum.

WebLens gets pages for AI agents: a single URL as markdown, a whole site crawled,
a site's URL list from its sitemap, or structured JSON pulled out of any page.
Paid endpoints settle over the x402 protocol (USDC on Base) — no accounts, no API keys.

## What It Costs

| Job | Endpoint | Price |
|-----|----------|-------|
| One page as markdown | POST /fetch/basic | ${PRICING.fetch.basic} |
| Whole site, crawled | POST /crawl | ${PRICING.crawl.perPage}/page |
| A site's URLs (sitemap) | POST /map | ${PRICING.map} |
| Many pages at once | POST /batch/fetch | ${PRICING.batchFetch.perUrl}/URL |
| JavaScript-rendered page | POST /fetch/pro | ${PRICING.fetch.pro} |
| Structured JSON from a page | POST /extract | ${PRICING.extract} |

Comparable search/scrape APIs bill $0.007-0.008 per request, or reach a lower
per-page rate only on a ~$99/month plan. WebLens has no plan to commit to, and
cached responses are another 70% off.

## Why Choose WebLens?

- **Zero friction**: No accounts, API keys, or subscriptions - just pay per request
- **Cheapest per page**: fetching and crawling run on Cloudflare's edge, and the price reflects it
- **AI-optimized**: Designed for autonomous agents with structured outputs
- **Instant settlement**: Payments settle in ~1-2 seconds on Base
- **No fees**: x402 protocol has 0 platform fees
- **Discoverable**: Indexed in the PayAI facilitator discovery catalog; standard x402 discovery at /.well-known/x402 and OpenAPI at /openapi.json

## Try It Now (Zero-Friction Reader)

Fetch any webpage as markdown with a single GET request — no auth, no payment, no setup:

  GET https://api.weblens.dev/r/https://example.com
  GET https://api.weblens.dev/s/your+search+query

Add ?format=text for plain output. Rate limited to 10/hour.
Reader: content truncated to 2000 chars. Search: max 3 results.
Upgrade to paid endpoints for full content and more results.

## Preview Before You Pay (Free)

Don't guess whether an endpoint is worth its price — ask:

  POST /preview {"endpoint": "/answer"}

Free (rate limited to 10/hour), and it returns the live price for that endpoint, a one-line
summary, and a recorded \`sample\` showing the exact response shape you would get.

LIVE vs RECORDED — the rule:
- Endpoints whose marginal cost is a plain fetch (/fetch/basic, /contents, /map) can also run a
  REAL truncated preview: pass a \`url\` and you get back a \`live\` block with the first 500
  characters of the actual result. \`livePreviewAvailable\` is true for exactly these.
- Every other endpoint is backed by a metered upstream (SerpAPI, Anthropic). Running those free
  would burn upstream credits, so they never run live — you get the recorded sample instead, which
  still shows every field name and type.

Unknown or unsold endpoint → 404.

## ERC-8004 (Trustless Agents) — Off-Chain Surfaces

WebLens hosts the OFF-CHAIN half of ERC-8004, which is what a service operator can run without
deploying a contract. WebLens is NOT registered on-chain, holds no agent id, and writes nothing to
any registry.

#### GET /.well-known/agent-registration.json
The ERC-8004 registration document (type \`…eip-8004#registration-v1\`): name, description, image,
services, active, x402Support, payment info, and the feedback endpoints. \`registrations\` is empty
because there is no on-chain registration; \`supportedTrust\` is ["feedback"]. (Free)

#### GET /receipts/{requestId}
The receipt for a paid call — your payment evidence. Every paid response returns \`X-Receipt-Id\`
and \`X-Receipt-Url\` headers pointing at it. Kept 30 days. (Free)
- Returns: \`{"type": "weblens-call-receipt-v1", "requestId", "endpoint", "method", "status", "outcome", "price?", "currency", "paymentMethod", "network", "payTo", "servedAt", "mac?", "keyId?", "alg?"}\`
- \`mac\` is a symmetric HMAC tag (same construction as proof-of-context): only a key holder can
  verify it. It is NOT a third-party-verifiable signature — do not treat it as one.

#### POST /feedback
Host a feedback document YOU author, and get back the pair \`giveFeedback()\` wants. WebLens stores
it verbatim and never edits or authors it; you post giveFeedback() yourself. (Free, rate limited)
- Body must include: \`agentRegistry\`, \`agentId\`, \`clientAddress\`, \`createdAt\`, \`value\`, \`valueDecimals\` (optional: \`tag1\`, \`tag2\`, \`endpoint\`, \`proofOfPayment\`, …)
- Returns 201: \`{"feedbackURI", "feedbackHash", "storedAt", "hashAlgorithm": "keccak256", "note", "requestId"}\`
- Missing a required field → 400 naming exactly which ones.
- Limits: body ≤ 256KB (413 past that), nesting ≤ 32 levels. Unknown fields are kept — they are part of what gets hashed.

#### GET /feedback/{id}
Serves the stored document byte-for-byte, so keccak-256 of the response equals the
\`feedbackHash\` you were given. This URL is the \`feedbackURI\`. (Free)

## Quick Start for AI Agents

0. Free evaluation: POST /preview {"endpoint": "/answer"} — see the price and response shape first
1. Try the free reader: GET /r/https://example.com (no wallet needed!)
2. For full access, call any paid endpoint (e.g., POST /fetch/basic with {"url": "https://example.com"})
3. Receive 402 Payment Required — read the PAYMENT-REQUIRED response header (base64-encoded JSON) for amount, asset, payTo and accepts
4. Sign USDC payment using your wallet (Base network)
5. Retry with the Payment-Signature header containing the signed payload
6. Receive data; settlement receipt is in the PAYMENT-RESPONSE response header

## Discovery Endpoints

- GET /r/{url} - Zero-friction reader (free, no auth needed)
- GET /s/{query} - Zero-friction search (free, no auth needed)
- POST /preview - Price + real response sample for any paid endpoint, before you pay (free)
- GET /discovery - Full service catalog with all endpoints, pricing, and capabilities
- GET /.well-known/x402 - Standard x402 discovery for Bazaar indexing
- GET /.well-known/agent-registration.json - ERC-8004 registration document (off-chain)
- GET /receipts/{requestId} - Receipt for a paid call (free)
- POST /feedback, GET /feedback/{id} - Host/serve an ERC-8004 feedback document (free)
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
- Price: ${PRICING.fetch.basic}
- Body: \`{"url": "string", "timeout?": number, "cache?": boolean}\`
- Returns: \`{"url", "title", "content", "metadata", "fetchedAt", "requestId"}\`

#### POST /fetch/pro
Fetch webpage with full JavaScript rendering. Use for SPAs and dynamic content.
- Price: ${PRICING.fetch.pro}
- Body: \`{"url": "string", "waitFor?": "string", "timeout?": number}\`
- Returns: \`{"url", "title", "content", "metadata", "tier", "fetchedAt", "requestId"}\`

#### POST /screenshot
Capture a screenshot of any webpage. Returns base64 PNG.
- Price: ${PRICING.screenshot}
- Body: \`{"url": "string", "viewport?": {"width": number, "height": number}, "fullPage?": boolean, "selector?": "string"}\`
- Returns: \`{"url", "image", "dimensions", "capturedAt", "requestId"}\`

#### POST /batch/fetch
Fetch multiple URLs in parallel. Efficient for bulk operations.
- Price: ${PRICING.batchFetch.perUrl} per URL (${PRICING.batchFetch.minUrls}-${PRICING.batchFetch.maxUrls} URLs)
- Body: \`{"urls": ["string"], "tier?": "basic"|"pro", "timeout?": number}\`
- Returns: \`{"results": [...], "summary", "totalPrice", "requestId"}\`

#### POST /fetch/resilient
Resilient fetch with automatic fallback: plain fetch first, then headless Chromium (JS rendering) when that fails. Best-effort retrieval in one call.
- Price: ${PRICING.fetch.resilient}
- Body: \`{"url": "string", "timeout?": number}\`
- Returns: \`{"url", "content", "provider": {"id", "name"}, "tier", "fetchedAt", "requestId"}\`

#### POST /contents
Cheap bulk page text: fetch ${PRICING.contents.minUrls}-${PRICING.contents.maxUrls} URLs and get clean markdown, truncated to a per-page cap.
- Price: ${PRICING.contents.perUrl} per URL (${PRICING.contents.minUrls}-${PRICING.contents.maxUrls} URLs)
- Body: \`{"urls": ["string"], "maxChars?": number, "timeout?": number}\`
- Returns: \`{"results": [{"url", "status", "title", "content", "truncated", "error?"}], "summary": {"total", "successful", "failed"}, "fetchedAt", "requestId"}\`

#### POST /map
Discover a site's URLs without fetching page content: robots.txt Sitemap: directives, then sitemap.xml and nested sitemap indexes, falling back to homepage link extraction.
- Price: ${PRICING.map}
- Body: \`{"url": "string", "limit?": number (1-5000, default 1000), "include?": ["string"], "exclude?": ["string"], "timeout?": number}\`
- Returns: \`{"url", "urls": ["string"], "total", "source": "sitemap"|"links"|"none", "sitemapsChecked", "mappedAt", "requestId"}\`

#### POST /crawl
Bounded same-host BFS crawl returning clean markdown for every page in ONE synchronous call — no async job, no polling. robots.txt honoured by default (403 FORBIDDEN if it disallows the start URL).
- Price: ${PRICING.crawl.perPage} per requested page (${PRICING.crawl.minPages}-${PRICING.crawl.maxPages}) — billed on the page budget you request (\`limit\`), not on pages actually returned
- Body: \`{"url": "string", "limit?": number (${PRICING.crawl.minPages}-${PRICING.crawl.maxPages}, default 10), "maxDepth?": number (0-3, default 2), "include?": ["string"], "exclude?": ["string"], "respectRobots?": boolean (default true), "maxChars?": number (500-50000, default 8000), "timeout?": number}\`
- Returns: \`{"url", "pages": [{"url", "depth", "status", "title?", "content?", "truncated?", "error?"}], "summary": {"crawled", "successful", "failed", "discovered", "limit", "maxDepth", "robotsRespected"}, "crawledAt", "requestId"}\`

### Search & Research

#### POST /search
Real-time web search. Returns titles, URLs, and snippets. Set includeContent to also fetch the top result pages as markdown in the same call.
- Price: ${PRICING.search} base + contentResults x ${PRICING.contents.perUrl} when includeContent is set
- Body: \`{"query": "string", "limit?": number, "includeContent?": boolean, "contentResults?": number (1-10, default 5), "contentChars?": number (500-20000, default 8000)}\`
- Returns: \`{"query", "results": [{"title", "url", "snippet", "content?", "contentTruncated?"}], "searchedAt", "requestId"}\`

#### POST /search/news
Real-time news search via Google News with source, date, and thumbnail.
- Price: ${PRICING.searchVerticals.news}
- Body: \`{"query": "string", "limit?": number}\`
- Returns: \`{"query", "results": [{"position", "title", "url", "source", "date", "isoDate", "thumbnail"}], "searchedAt", "requestId"}\`

#### POST /search/images
Google Images search with direct image URLs, dimensions, and source pages.
- Price: ${PRICING.searchVerticals.images}
- Body: \`{"query": "string", "limit?": number}\`
- Returns: \`{"query", "results": [{"position", "title", "imageUrl", "thumbnail", "sourcePage", "source", "width", "height"}], "searchedAt", "requestId"}\`

#### POST /search/places
Local business search via Google Local: ratings, reviews, phone, website, coordinates.
- Price: ${PRICING.searchVerticals.places}
- Body: \`{"query": "string", "location?": "string", "limit?": number}\`
- Returns: \`{"query", "results": [{"position", "name", "address", "rating", "reviews", "priceLevel", "category", "phone", "website", "placeId", "coordinates"}], "searchedAt", "requestId"}\`

#### POST /search/shopping
Google Shopping product search with prices, sellers, and ratings.
- Price: ${PRICING.searchVerticals.shopping}
- Body: \`{"query": "string", "limit?": number}\`
- Returns: \`{"query", "results": [{"position", "title", "url", "price", "extractedPrice", "source", "rating", "reviews", "thumbnail"}], "searchedAt", "requestId"}\`

#### POST /search/scholar
Google Scholar academic search with publication info and citation counts.
- Price: ${PRICING.searchVerticals.scholar}
- Body: \`{"query": "string", "limit?": number}\`
- Returns: \`{"query", "results": [{"position", "title", "url", "snippet", "publicationInfo", "citedBy"}], "searchedAt", "requestId"}\`

#### POST /search/autocomplete
Google Autocomplete suggestions for a partial query — keyword research and intent discovery.
- Price: ${PRICING.searchVerticals.autocomplete}
- Body: \`{"query": "string", "limit?": number}\`
- Returns: \`{"query", "suggestions": ["string"], "searchedAt", "requestId"}\`

#### POST /search/trends
Google Trends interest-over-time timeline for a query.
- Price: ${PRICING.searchVerticals.trends}
- Body: \`{"query": "string"}\`
- Returns: \`{"query", "timeline": [{"date", "timestamp", "values": [{"query", "value"}]}], "searchedAt", "requestId"}\`

#### POST /answer
Grounded answer with inline [n] citations: searches the web, fetches sources, and answers strictly from them.
- Price: ${PRICING.answer}
- Body: \`{"query": "string", "sources?": number (1-5, default 3)}\`
- Returns: \`{"query", "answer", "citations": [{"index", "url", "title"}], "confidence?", "answeredAt", "requestId"}\`

#### POST /research
One-stop research: searches web, fetches top results, generates AI summary with key findings.
- Price: ${PRICING.research}
- Body: \`{"query": "string", "resultCount?": number, "includeRawContent?": boolean}\`
- Returns: \`{"query", "sources", "summary", "keyFindings", "researchedAt", "requestId"}\`

#### POST /research/deep
Multi-step cited research in ONE synchronous call: plans sub-questions, runs a web search per sub-question, fetches and dedupes sources across them, then synthesizes an answer with inline [n] citations, key findings, and gaps.
- Price: ${PRICING.deepResearch.standard} standard (3 sub-questions, 8 sources) / ${PRICING.deepResearch.deep} deep (5 sub-questions, 12 sources)
- Body: \`{"query": "string (1-500 chars)", "depth?": "standard"|"deep" (default standard)}\`
- Returns: \`{"query", "depth", "subQuestions": ["string"], "answer", "keyFindings": ["string"], "citations": [{"index", "url", "title", "subQuestion"}], "gaps": ["string"], "sourcesFetched", "researchedAt", "requestId"}\`
- **SLOW — set a generous HTTP timeout.** A standard run takes roughly 30-60 seconds (measured ~35s); deep takes longer. 120s client timeout recommended. Do not retry on client timeout — you would pay twice.
- vs /research (${PRICING.research}): /research runs ONE search and returns a prose summary; /research/deep decomposes the question into sub-questions, searches each, and cites every claim inline with [n] markers you can resolve via the citations array.

### Social Data

#### POST /social/youtube/transcript
Full transcript of any YouTube video with timestamps. Accepts a video ID or any YouTube URL (watch, shorts, youtu.be).
- Price: ${PRICING.youtubeTranscript}
- Body: \`{"videoId": "string (ID or URL)", "lang?": "string"}\`
- Returns: \`{"videoId", "language?", "segments": [{"startMs", "startTime", "text"}], "fullText", "fetchedAt", "requestId"}\`

### Data Extraction

#### POST /extract
Extract structured data from webpages using JSON schema.
- Price: ${PRICING.extract}
- Body: \`{"url": "string", "schema": object, "instructions?": "string"}\`
- Returns: \`{"url", "data", "extractedAt", "requestId"}\`

#### POST /extract/smart
AI-powered data extraction using natural language. Just describe what you want.
- Price: ${PRICING.smartExtract}
- Body: \`{"url": "string", "query": "string", "format?": "json"|"text"}\`
- Returns: \`{"url", "query", "data", "explanation", "extractedAt", "requestId"}\`

#### POST /pdf
Extract text and metadata from PDF documents.
- Price: ${PRICING.pdf}
- Body: \`{"url": "string", "pages?": [number]}\`
- Returns: \`{"url", "metadata", "pages", "fullText", "extractedAt", "requestId"}\`

#### POST /compare
Compare 2-3 webpages with AI-generated analysis of similarities and differences.
- Price: ${PRICING.compare}
- Body: \`{"urls": ["string"], "focus?": "string"}\`
- Returns: \`{"sources", "comparison": {"summary", "similarities", "differences"}, "comparedAt", "requestId"}\`

### Monitoring

#### POST /monitor/create
Create a URL monitor for change detection.
- Price: ${PRICING.monitor.setup}
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
- Price: ${PRICING.intel.company}
- Body: \`{"target": "string"}\` (company name or domain)
- Returns: \`{"name", "domain", "funding", "summary", "requestId"}\`

#### POST /intel/market
Market research report: executive summary, market size, growth, key trends, key players, recommendations.
- Price: ${PRICING.intel.market}
- Body: \`{"topic": "string", "depth?": "quick"|"standard"|"comprehensive", "focus?": "string"}\`
- Returns: \`{"topic", "executiveSummary", "marketSize", "growthRate", "keyTrends", "keyPlayers", "recommendations", "requestId"}\`

#### POST /intel/competitive
Competitive analysis: feature matrix, pricing comparison, SWOT, positioning.
- Price: ${PRICING.intel.competitive}
- Body: \`{"company": "string", "maxCompetitors?": number, "focus?": "string"}\`
- Returns: \`{"company", "competitors", "featureMatrix", "pricing", "swot", "positioning", "requestId"}\`

#### POST /intel/site-audit
Full site audit: SEO, performance, security, accessibility scoring with actionable recommendations.
- Price: ${PRICING.intel.siteAudit}
- Body: \`{"url": "string"}\`
- Returns: \`{"url", "scores": {"seo", "performance", "security", "accessibility"}, "issues", "recommendations", "requestId"}\`

### Memory (Key-Value Storage)

#### POST /memory/set
Store a value in persistent key-value storage.
- Price: ${PRICING.memory.write}
- Body: \`{"key": "string", "value": any, "ttl?": number}\`
- Returns: \`{"key", "stored", "expiresAt", "requestId"}\`

#### GET /memory/get?key={key}
Retrieve a stored value by key. Requires wallet auth.
- Returns: \`{"key", "value", "storedAt", "expiresAt", "requestId"}\`

#### GET /memory/list
List all stored keys for the authenticated wallet.
- Returns: \`{"keys": ["string"], "count", "requestId"}\`

#### DELETE /memory/delete?key={key}
Delete a stored value. Requires wallet auth.
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
      "args": ["-y", "@weblens/mcp"],
      "env": {
        "PRIVATE_KEY": "0xYourPrivateKeyHere"
      }
    }
  }
}
\`\`\`

## Available MCP Tools

- \`preview_endpoint\` - Price + real response sample for any paid endpoint, before paying — free
- \`fetch_webpage\` - Fetch webpage as markdown (basic) — ${PRICING.fetch.basic}
- \`fetch_webpage_pro\` - Fetch with JS rendering — ${PRICING.fetch.pro}
- \`fetch_resilient\` - Resilient fetch with provider fallback — ${PRICING.fetch.resilient}
- \`screenshot\` - Capture webpage screenshot — ${PRICING.screenshot}
- \`search_web\` - Real-time web search (optional page content) — ${PRICING.search}
- \`search_news\` - Google News search — ${PRICING.searchVerticals.news}
- \`search_images\` - Google Images search — ${PRICING.searchVerticals.images}
- \`search_places\` - Local business search (Google Local) — ${PRICING.searchVerticals.places}
- \`search_shopping\` - Google Shopping product search — ${PRICING.searchVerticals.shopping}
- \`search_scholar\` - Google Scholar academic search — ${PRICING.searchVerticals.scholar}
- \`search_autocomplete\` - Query autocomplete suggestions — ${PRICING.searchVerticals.autocomplete}
- \`search_trends\` - Google Trends interest over time — ${PRICING.searchVerticals.trends}
- \`youtube_transcript\` - YouTube video transcript with timestamps — ${PRICING.youtubeTranscript}
- \`get_contents\` - Bulk page contents (${PRICING.contents.minUrls}-${PRICING.contents.maxUrls} URLs) — ${PRICING.contents.perUrl}/URL
- \`answer_question\` - Grounded answer with citations — ${PRICING.answer}
- \`extract_data\` - Extract structured data with JSON schema — ${PRICING.extract}
- \`smart_extract\` - AI-powered natural-language extraction — ${PRICING.smartExtract}
- \`research\` - Search + fetch + AI summary — ${PRICING.research}
- \`deep_research\` - Multi-step cited research (sub-questions + inline [n] citations; 30-60s) — ${PRICING.deepResearch.standard} standard / ${PRICING.deepResearch.deep} deep
- \`batch_fetch\` - Fetch multiple URLs in parallel — ${PRICING.batchFetch.perUrl}/URL
- \`map_site\` - Discover a site's URLs via sitemap/robots/links — ${PRICING.map}
- \`crawl_site\` - Bounded same-host crawl to markdown (${PRICING.crawl.minPages}-${PRICING.crawl.maxPages} pages) — ${PRICING.crawl.perPage}/requested page
- \`extract_pdf\` - Extract text from PDFs — ${PRICING.pdf}
- \`compare_urls\` - Compare 2-3 webpages — ${PRICING.compare}
- \`monitor_create\` - Create URL change monitor — ${PRICING.monitor.setup}
- \`memory_set\` - Persistent key-value storage — ${PRICING.memory.write}
- \`intel_company\` - Company deep dive (AI-powered) — ${PRICING.intel.company}
- \`intel_market\` - Market research report — ${PRICING.intel.market}
- \`intel_competitive\` - Competitive analysis — ${PRICING.intel.competitive}
- \`intel_site_audit\` - SEO/performance/security audit — ${PRICING.intel.siteAudit}

### Agent Credits (Prepaid)

Bypass per-request x402 signatures by pre-funding an account.

#### POST /credits/buy
Purchase credits with x402. Pay $2-$1000; deposit bonuses: 20% at $10+, 30% at $50+, 40% at $100+.
- Body: \`{"amount": 10}\` (USD, number, 2-1000)

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
- \`X-Receipt-Id\` / \`X-Receipt-Url\` - Receipt for a paid call, fetchable at GET /receipts/{requestId} for 30 days

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