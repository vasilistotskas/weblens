#!/usr/bin/env node
/**
 * WebLens MCP Server
 * Exposes WebLens API tools to AI agents via Model Context Protocol
 * Handles x402 payments automatically using v2 API
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { x402Client, wrapAxiosWithPayment } from "@x402/axios";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import axios, { AxiosInstance } from "axios";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod/v4";

// Configuration from environment
const WEBLENS_URL = process.env.WEBLENS_URL || "https://api.weblens.dev";
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;

if (!PRIVATE_KEY) {
  console.error("Error: PRIVATE_KEY environment variable is required");
  console.error("Set it to your wallet private key (with USDC on Base)");
  process.exit(1);
}

/**
 * Prices are duplicated from the Worker's `src/config.ts` PRICING object.
 * This package is published standalone and cannot import from the Worker, so
 * these literals MUST be kept in sync with `src/config.ts` by hand.
 */
const PRICE = {
  fetchBasic: "$0.002",
  fetchPro: "$0.006",
  fetchResilient: "$0.008",
  screenshot: "$0.008",
  search: "$0.015",
  searchNews: "$0.015",
  searchImages: "$0.015",
  searchPlaces: "$0.045",
  searchShopping: "$0.015",
  searchScholar: "$0.015",
  searchAutocomplete: "$0.015",
  searchTrends: "$0.015",
  youtubeTranscript: "$0.03",
  contentsPerUrl: "$0.0015",
  answer: "$0.05",
  extract: "$0.03",
  smartExtract: "$0.035",
  research: "$0.08",
  deepResearchStandard: "$0.20",
  deepResearchDeep: "$0.35",
  pdf: "$0.004",
  compare: "$0.05",
  batchFetchPerUrl: "$0.0015",
  map: "$0.004",
  domain: "$0.005",
  package: "$0.003",
  tech: "$0.005",
  discussions: "$0.004",
  crawlPerPage: "$0.0015",
  monitorSetup: "$0.01",
  memoryWrite: "$0.001",
  intelCompany: "$1.00",
  intelMarket: "$5.00",
  intelCompetitive: "$8.00",
  intelSiteAudit: "$0.75",
  intelProject: "$0.05",
} as const;

// Client will be initialized async
let client: AxiosInstance;

async function initClient() {
  // Create account from private key
  const account = privateKeyToAccount(PRIVATE_KEY);

  // Create x402 client and register EVM scheme
  const x402 = new x402Client();
  registerExactEvmScheme(x402, { signer: account });

  // Create axios client with x402 payment handling
  client = wrapAxiosWithPayment(
    axios.create({ baseURL: WEBLENS_URL }),
    x402
  );
}

// Create MCP server
const server = new McpServer({
  name: "weblens",
  version: "2.0.0",
});

/** Build a clear, single-line error message from an unknown thrown value. */
function describeError(error: unknown, action: string): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const apiMessage =
      (error.response?.data as { error?: string; message?: string } | undefined)
        ?.message ??
      (error.response?.data as { error?: string } | undefined)?.error;
    const statusPart = status ? ` (HTTP ${status})` : "";
    return `Failed to ${action}${statusPart}: ${apiMessage ?? error.message}`;
  }
  return `Failed to ${action}: ${error instanceof Error ? error.message : String(error)}`;
}

/** Wrap a tool body so all errors return an isError CallToolResult. */
async function runTool(
  action: string,
  body: () => Promise<CallToolResult>
): Promise<CallToolResult> {
  try {
    return await body();
  } catch (error) {
    return {
      content: [{ type: "text", text: describeError(error, action) }],
      isError: true,
    };
  }
}

/** Require a field on the response payload; throw a clear error if missing. */
function requireField<T>(value: T | undefined | null, field: string): T {
  if (value === undefined || value === null) {
    throw new Error(`Unexpected API response: missing field "${field}"`);
  }
  return value;
}

/** A single plain-text content block. */
function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

/** A single JSON-encoded text content block, for structured payloads. */
function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

// Shared primitives — mirror the canonical Zod schemas in src/schemas.ts.
const urlField = z.string().url();
const timeoutField = z
  .number()
  .min(5000)
  .max(30000)
  .optional()
  .describe("Request timeout in ms (5000-30000, default: 10000)");
const cacheField = z
  .boolean()
  .optional()
  .describe("Serve/store a cached response (default: true, 70% cheaper on a hit)");
const cacheTtlField = z
  .number()
  .min(60)
  .max(86400)
  .optional()
  .describe("Cache TTL in seconds (60-86400, default: 3600)");
const queryField = z.string().min(1).max(500);
const searchLimitField = z
  .number()
  .min(1)
  .max(20)
  .optional()
  .describe("Number of results (1-20, default: 10)");
const pathFilterField = z.array(z.string().min(1).max(200)).max(20).optional();

// ============================================
// Evaluation — free, no payment
// ============================================

// Tool: Preview a paid endpoint before paying for it
server.registerTool(
  "preview_endpoint",
  {
    description:
      "FREE. See what a paid WebLens endpoint costs and what it returns before paying: the live price, a one-line summary, and a recorded sample of the exact response shape. Endpoints with no paid upstream (/fetch/basic, /contents, /map) also run a real truncated LIVE preview when you pass a url; SerpAPI- and Anthropic-backed endpoints return the recorded sample only, because free live runs there would burn upstream credits. Price: free",
    inputSchema: z.object({
      endpoint: z
        .string()
        .min(1)
        .max(100)
        .describe("Paid endpoint path to preview, e.g. \"/answer\""),
      url: urlField
        .optional()
        .describe(
          "Fetch-backed endpoints only (/fetch/basic, /contents, /map): run a real truncated preview of this URL"
        ),
    }),
  },
  async ({ endpoint, url }) =>
    runTool("preview endpoint", async () => {
      const res = await client.post("/preview", { endpoint, url });
      requireField(res.data?.price, "price");
      return jsonResult(res.data);
    })
);

// ============================================
// Core — fetch, render, capture
// ============================================

// Tool: Fetch webpage (basic)
server.registerTool(
  "fetch_webpage",
  {
    description: `Fetch and convert a webpage to clean markdown. Fast, no JavaScript rendering. Price: ${PRICE.fetchBasic}`,
    inputSchema: z.object({
      url: urlField.describe("The URL to fetch"),
      timeout: timeoutField,
      cache: cacheField,
      cacheTtl: cacheTtlField,
    }),
  },
  async ({ url, timeout, cache, cacheTtl }) =>
    runTool("fetch webpage", async () => {
      const res = await client.post("/fetch/basic", {
        url,
        timeout,
        cache,
        cacheTtl,
      });
      const text = res.data?.content ?? res.data?.markdown;
      return textResult(requireField(text, "content"));
    })
);

// Tool: Fetch webpage with JS rendering (pro)
server.registerTool(
  "fetch_webpage_pro",
  {
    description: `Fetch webpage with full JavaScript rendering. Use for SPAs and dynamic content. Price: ${PRICE.fetchPro}`,
    inputSchema: z.object({
      url: urlField.describe("The URL to fetch"),
      waitFor: z
        .string()
        .optional()
        .describe("CSS selector to wait for before capturing content (e.g. \".content\")"),
      timeout: timeoutField,
      cache: cacheField,
      cacheTtl: cacheTtlField,
    }),
  },
  async ({ url, waitFor, timeout, cache, cacheTtl }) =>
    runTool("fetch webpage (pro)", async () => {
      const res = await client.post("/fetch/pro", {
        url,
        waitFor,
        timeout,
        cache,
        cacheTtl,
      });
      const text = res.data?.content ?? res.data?.markdown;
      return textResult(requireField(text, "content"));
    })
);

// Tool: Resilient fetch (multi-provider fallback)
server.registerTool(
  "fetch_resilient",
  {
    description: `Resilient multi-provider fetch with automatic fallback (WebLens -> Firecrawl -> Zyte). Price: ${PRICE.fetchResilient}`,
    inputSchema: z.object({
      url: urlField.describe("The URL to fetch"),
      timeout: timeoutField,
      cache: cacheField,
      cacheTtl: cacheTtlField,
    }),
  },
  async ({ url, timeout, cache, cacheTtl }) =>
    runTool("fetch webpage (resilient)", async () => {
      const res = await client.post("/fetch/resilient", {
        url,
        timeout,
        cache,
        cacheTtl,
      });
      const text = res.data?.content ?? res.data?.markdown;
      return textResult(requireField(text, "content"));
    })
);

// Tool: Screenshot
server.registerTool(
  "screenshot",
  {
    description: `Capture a screenshot of a webpage. Returns base64 PNG image. Price: ${PRICE.screenshot}`,
    inputSchema: z.object({
      url: urlField.describe("The URL to screenshot"),
      width: z
        .number()
        .min(320)
        .max(3840)
        .optional()
        .describe("Viewport width (320-3840, default: 1280)"),
      height: z
        .number()
        .min(240)
        .max(2160)
        .optional()
        .describe("Viewport height (240-2160, default: 720)"),
      fullPage: z.boolean().optional().describe("Capture full page scroll"),
      selector: z.string().optional().describe("CSS selector to capture"),
      timeout: timeoutField,
    }),
  },
  async ({ url, width, height, fullPage, selector, timeout }) =>
    runTool("capture screenshot", async () => {
      const res = await client.post("/screenshot", {
        url,
        width,
        height,
        fullPage,
        selector,
        timeout,
      });
      return {
        content: [
          {
            type: "image",
            data: requireField(res.data?.image, "image"),
            mimeType: "image/png",
          },
        ],
      };
    })
);

// ============================================
// Search — web and SERP verticals
// ============================================

// Tool: Web search
server.registerTool(
  "search_web",
  {
    description: `Search the web and get real-time results with snippets. Set includeContent to also fetch the top result pages as markdown (+${PRICE.contentsPerUrl}/result). Price: ${PRICE.search}`,
    inputSchema: z.object({
      query: queryField.describe("Search query"),
      limit: searchLimitField,
      includeContent: z
        .boolean()
        .optional()
        .describe(`Also fetch top result pages as markdown (+${PRICE.contentsPerUrl}/result)`),
      contentResults: z
        .number()
        .min(1)
        .max(10)
        .optional()
        .describe("How many top results to fetch content for (1-10, default: 5)"),
      contentChars: z
        .number()
        .min(500)
        .max(20000)
        .optional()
        .describe("Per-page content character cap (500-20000, default: 8000)"),
    }),
  },
  async ({ query, limit, includeContent, contentResults, contentChars }) =>
    runTool("search the web", async () => {
      const res = await client.post("/search", {
        query,
        limit,
        includeContent,
        contentResults,
        contentChars,
      });
      return jsonResult(requireField(res.data?.results, "results"));
    })
);

// Tool: News search
server.registerTool(
  "search_news",
  {
    description: `Search Google News for real-time articles with source, date, and thumbnail. Price: ${PRICE.searchNews}`,
    inputSchema: z.object({
      query: queryField.describe("News search query"),
      limit: searchLimitField,
    }),
  },
  async ({ query, limit }) =>
    runTool("search news", async () => {
      const res = await client.post("/search/news", { query, limit });
      return jsonResult(requireField(res.data?.results, "results"));
    })
);

// Tool: Image search
server.registerTool(
  "search_images",
  {
    description: `Search Google Images for direct image URLs with dimensions, thumbnails, and source pages. Price: ${PRICE.searchImages}`,
    inputSchema: z.object({
      query: queryField.describe("Image search query"),
      limit: searchLimitField,
    }),
  },
  async ({ query, limit }) =>
    runTool("search images", async () => {
      const res = await client.post("/search/images", { query, limit });
      return jsonResult(requireField(res.data?.results, "results"));
    })
);

// Tool: Local business / places search
server.registerTool(
  "search_places",
  {
    description: `Search local businesses via Google Local: names, addresses, ratings, reviews, phone, website, coordinates. Price: ${PRICE.searchPlaces}`,
    inputSchema: z.object({
      query: queryField.describe("What to search for (e.g. coffee shops)"),
      location: z
        .string()
        .min(2)
        .max(200)
        .optional()
        .describe("Free-text location bias, e.g. \"Austin, Texas\""),
      limit: searchLimitField,
    }),
  },
  async ({ query, location, limit }) =>
    runTool("search places", async () => {
      const res = await client.post("/search/places", { query, location, limit });
      return jsonResult(requireField(res.data?.results, "results"));
    })
);

// Tool: Shopping search
server.registerTool(
  "search_shopping",
  {
    description: `Search Google Shopping for products with prices, sellers, ratings, and links. Price: ${PRICE.searchShopping}`,
    inputSchema: z.object({
      query: queryField.describe("Product search query"),
      limit: searchLimitField,
    }),
  },
  async ({ query, limit }) =>
    runTool("search shopping", async () => {
      const res = await client.post("/search/shopping", { query, limit });
      return jsonResult(requireField(res.data?.results, "results"));
    })
);

// Tool: Academic search
server.registerTool(
  "search_scholar",
  {
    description: `Search Google Scholar for academic papers with snippets, publication info, and citation counts. Price: ${PRICE.searchScholar}`,
    inputSchema: z.object({
      query: queryField.describe("Academic search query"),
      limit: searchLimitField,
    }),
  },
  async ({ query, limit }) =>
    runTool("search scholar", async () => {
      const res = await client.post("/search/scholar", { query, limit });
      return jsonResult(requireField(res.data?.results, "results"));
    })
);

// Tool: Autocomplete suggestions
server.registerTool(
  "search_autocomplete",
  {
    description: `Get Google Autocomplete suggestions for a partial query — keyword research and intent discovery. Price: ${PRICE.searchAutocomplete}`,
    inputSchema: z.object({
      query: queryField.describe("Partial query to complete"),
      limit: z
        .number()
        .min(1)
        .max(20)
        .optional()
        .describe("Max suggestions (1-20, default: 10)"),
    }),
  },
  async ({ query, limit }) =>
    runTool("get autocomplete suggestions", async () => {
      const res = await client.post("/search/autocomplete", { query, limit });
      return jsonResult(requireField(res.data?.suggestions, "suggestions"));
    })
);

// Tool: Trends
server.registerTool(
  "search_trends",
  {
    description: `Get Google Trends interest-over-time timeline for a query. Price: ${PRICE.searchTrends}`,
    inputSchema: z.object({
      query: queryField.describe("Topic to get trend data for"),
    }),
  },
  async ({ query }) =>
    runTool("get trend data", async () => {
      const res = await client.post("/search/trends", { query });
      return jsonResult(requireField(res.data?.timeline, "timeline"));
    })
);

// ============================================
// Social
// ============================================

// Tool: YouTube transcript
server.registerTool(
  "youtube_transcript",
  {
    description: `Get the full transcript of a YouTube video with timestamps. Accepts a video ID or any YouTube URL. Price: ${PRICE.youtubeTranscript}`,
    inputSchema: z.object({
      videoId: z
        .string()
        .min(5)
        .max(200)
        .describe("YouTube video ID (e.g. dQw4w9WgXcQ) or full video URL"),
      lang: z
        .string()
        .min(2)
        .max(10)
        .optional()
        .describe("Transcript language code (default: video default)"),
    }),
  },
  async ({ videoId, lang }) =>
    runTool("get YouTube transcript", async () => {
      const res = await client.post("/social/youtube/transcript", { videoId, lang });
      return textResult(requireField(res.data?.fullText, "fullText"));
    })
);

// ============================================
// Extraction
// ============================================

// Tool: Bulk page contents
server.registerTool(
  "get_contents",
  {
    description: `Fetch 1-20 URLs and get clean markdown per page, truncated to a character cap. Price: ${PRICE.contentsPerUrl}/URL`,
    inputSchema: z.object({
      urls: z.array(urlField).min(1).max(20).describe("URLs to fetch (1-20)"),
      maxChars: z
        .number()
        .min(500)
        .max(50000)
        .optional()
        .describe("Per-page content character cap (500-50000, default: 20000)"),
      timeout: timeoutField.describe("Per-URL timeout in ms (5000-30000, default: 10000)"),
    }),
  },
  async ({ urls, maxChars, timeout }) =>
    runTool("fetch page contents", async () => {
      const res = await client.post("/contents", { urls, maxChars, timeout });
      return jsonResult(requireField(res.data?.results, "results"));
    })
);

// Tool: Extract structured data (JSON schema, AI-powered)
server.registerTool(
  "extract_data",
  {
    description: `Extract structured data from a webpage using a JSON schema. AI-powered extraction. Price: ${PRICE.extract}`,
    inputSchema: z.object({
      url: urlField.describe("The URL to extract from"),
      schema: z
        .record(z.string(), z.unknown())
        .describe("JSON schema defining the data structure to extract"),
      instructions: z
        .string()
        .optional()
        .describe("Natural language instructions to guide extraction"),
    }),
  },
  async ({ url, schema, instructions }) =>
    runTool("extract data", async () => {
      const res = await client.post("/extract", { url, schema, instructions });
      return jsonResult(requireField(res.data?.data, "data"));
    })
);

// Tool: Smart extract (AI-powered, natural language)
server.registerTool(
  "smart_extract",
  {
    description: `Extract data using natural language. AI understands what you want. Price: ${PRICE.smartExtract}`,
    inputSchema: z.object({
      url: urlField.describe("The URL to extract from"),
      query: queryField.describe("What data to extract (natural language)"),
      format: z
        .enum(["json", "text"])
        .optional()
        .describe("Output format (default: json)"),
    }),
  },
  async ({ url, query, format }) =>
    runTool("smart extract data", async () => {
      const res = await client.post("/extract/smart", { url, query, format });
      return jsonResult(requireField(res.data?.data, "data"));
    })
);

// Tool: PDF extraction
server.registerTool(
  "extract_pdf",
  {
    description: `Extract text and metadata from a PDF document. Price: ${PRICE.pdf}`,
    inputSchema: z.object({
      url: urlField.describe("URL of the PDF to extract"),
      pages: z
        .array(z.number().min(1))
        .optional()
        .describe("1-based page numbers to extract (default: all pages)"),
    }),
  },
  async ({ url, pages }) =>
    runTool("extract PDF", async () => {
      const res = await client.post("/pdf", { url, pages });
      return textResult(requireField(res.data?.fullText, "fullText"));
    })
);

// ============================================
// Research & analysis
// ============================================

// Tool: Grounded answer with citations
server.registerTool(
  "answer_question",
  {
    description: `Get a grounded answer with inline [n] citations: searches the web, fetches sources, and answers strictly from them. Price: ${PRICE.answer}`,
    inputSchema: z.object({
      query: queryField.describe("The question to answer"),
      sources: z
        .number()
        .min(1)
        .max(5)
        .optional()
        .describe("Web sources to search, fetch, and cite (1-5, default: 3)"),
    }),
  },
  async ({ query, sources }) =>
    runTool("answer question", async () => {
      const res = await client.post("/answer", { query, sources });
      const answer = requireField(res.data?.answer, "answer");
      return {
        content: [
          { type: "text", text: answer },
          {
            type: "text",
            text: `Citations:\n${JSON.stringify(res.data?.citations ?? [], null, 2)}`,
          },
        ],
      };
    })
);

// Tool: Research
server.registerTool(
  "research",
  {
    description: `One-stop research: searches web, fetches top results, and summarizes findings. Price: ${PRICE.research}`,
    inputSchema: z.object({
      query: queryField.describe("Research topic or question"),
      resultCount: z
        .number()
        .min(1)
        .max(10)
        .optional()
        .describe("Number of sources to analyze (1-10, default: 5)"),
      includeRawContent: z
        .boolean()
        .optional()
        .describe("Include the raw fetched page content for each source"),
    }),
  },
  async ({ query, resultCount, includeRawContent }) =>
    runTool("perform research", async () => {
      const res = await client.post("/research", {
        query,
        resultCount,
        includeRawContent,
      });
      return textResult(requireField(res.data?.summary, "summary"));
    })
);

// Tool: Deep research (multi-step, cited)
server.registerTool(
  "deep_research",
  {
    description: `Multi-step cited research in one call: plans sub-questions, searches each, fetches and dedupes sources, then synthesizes an answer with inline [n] citations, key findings, and gaps. Unlike \`research\` (${PRICE.research}, one search + summary) this decomposes the question and cites every claim. SLOW: a standard run takes ~30-60 seconds — use a generous client timeout and do not retry on timeout. Price: ${PRICE.deepResearchStandard} standard (3 sub-questions, 8 sources) / ${PRICE.deepResearchDeep} deep (5 sub-questions, 12 sources)`,
    inputSchema: z.object({
      query: queryField.describe("The research question (1-500 chars)"),
      depth: z
        .enum(["standard", "deep"])
        .optional()
        .describe(
          `Research tier: standard = 3 sub-questions / 8 sources (${PRICE.deepResearchStandard}); deep = 5 / 12 (${PRICE.deepResearchDeep}). Default: standard`
        ),
    }),
  },
  async ({ query, depth }) =>
    runTool("perform deep research", async () => {
      const res = await client.post(
        "/research/deep",
        { query, depth },
        // The pipeline runs several searches and fetches before synthesis;
        // ~35s is typical for standard, so allow well beyond that.
        { timeout: 180000 }
      );
      const answer = requireField(res.data?.answer, "answer");
      return {
        content: [
          { type: "text", text: answer },
          {
            type: "text",
            text: `Key findings:\n${JSON.stringify(res.data?.keyFindings ?? [], null, 2)}`,
          },
          {
            type: "text",
            text: `Citations:\n${JSON.stringify(res.data?.citations ?? [], null, 2)}`,
          },
          {
            type: "text",
            text: `Gaps:\n${JSON.stringify(res.data?.gaps ?? [], null, 2)}`,
          },
        ],
      };
    })
);

// Tool: Compare URLs
server.registerTool(
  "compare_urls",
  {
    description: `Compare 2-3 webpages and get AI-generated analysis of differences. Price: ${PRICE.compare}`,
    inputSchema: z.object({
      urls: z.array(urlField).min(2).max(3).describe("URLs to compare (2-3)"),
      focus: z
        .string()
        .optional()
        .describe("What to focus comparison on (default: general)"),
    }),
  },
  async ({ urls, focus }) =>
    runTool("compare URLs", async () => {
      const res = await client.post("/compare", { urls, focus });
      const summary = res.data?.comparison?.summary;
      return textResult(requireField(summary, "comparison.summary"));
    })
);

// ============================================
// Crawling
// ============================================

// Tool: Batch fetch
server.registerTool(
  "batch_fetch",
  {
    description: `Fetch multiple URLs in parallel. Efficient for bulk operations. Price: ${PRICE.batchFetchPerUrl}/URL`,
    inputSchema: z.object({
      urls: z.array(urlField).min(2).max(20).describe("URLs to fetch (2-20)"),
      timeout: timeoutField.describe("Per-URL timeout in ms (5000-30000, default: 10000)"),
      tier: z
        .enum(["basic", "pro"])
        .optional()
        .describe("Fetch tier (default: basic)"),
    }),
  },
  async ({ urls, timeout, tier }) =>
    runTool("batch fetch URLs", async () => {
      const res = await client.post("/batch/fetch", { urls, timeout, tier });
      return jsonResult(requireField(res.data?.results, "results"));
    })
);

// Tool: Map site URLs
server.registerTool(
  "map_site",
  {
    description: `Discover a site's URLs without fetching page content — reads robots.txt sitemap directives, sitemap.xml and nested sitemap indexes, falling back to homepage link extraction. Price: ${PRICE.map}`,
    inputSchema: z.object({
      url: urlField.describe("Site URL to map"),
      limit: z
        .number()
        .min(1)
        .max(5000)
        .optional()
        .describe("Maximum URLs to return (1-5000, default: 1000)"),
      include: pathFilterField.describe(
        "Only URLs whose path+query contains one of these substrings"
      ),
      exclude: pathFilterField.describe(
        "Skip URLs whose path+query contains one of these substrings"
      ),
      timeout: timeoutField,
    }),
  },
  async ({ url, limit, include, exclude, timeout }) =>
    runTool("map site", async () => {
      const res = await client.post("/map", { url, limit, include, exclude, timeout });
      const urls = requireField(res.data?.urls, "urls");
      return jsonResult({
        urls,
        total: res.data?.total,
        source: res.data?.source,
      });
    })
);

// Tool: Domain intelligence
server.registerTool(
  "domain_intel",
  {
    description: `Everything about a domain in one call: who registered it and when, when it expires, its DNS records, the mail and DNS providers behind them, the SaaS vendors its TXT verification tokens reveal (Google Workspace, Microsoft 365, Salesforce, Atlassian, Okta, …), SPF/DMARC posture, and risk flags like newly-registered or no-registrar-lock. Use for vendor due diligence, security triage, phishing checks and prospect research. Price: ${PRICE.domain}`,
    inputSchema: z.object({
      domain: z
        .string()
        .min(3)
        .max(253)
        .describe("Domain to inspect, e.g. \"stripe.com\". A full URL is reduced to its hostname."),
    }),
  },
  async ({ domain }) =>
    runTool("domain intel", async () => {
      const res = await client.post("/domain", { domain });
      return jsonResult({
        domain: res.data?.domain,
        registration: res.data?.registration,
        dns: res.data?.dns,
        email: res.data?.email,
        hosting: res.data?.hosting,
        stack: res.data?.stack,
        signals: res.data?.signals,
        ageDays: res.data?.ageDays,
        expiresInDays: res.data?.expiresInDays,
      });
    })
);

// Tool: Off-chain project due diligence
server.registerTool(
  "project_due_diligence",
  {
    description: `Off-chain due diligence on a project's web presence — the half an on-chain rug checker cannot see. Returns domain age and registrar, whether a team page, whitepaper, docs and socials exist, whether the site is an off-the-shelf template, and a cross-check of a contract address against the addresses actually printed on the project's own website (a mismatch is a strong impersonation signal). Gives weighted risk signals and an A-F grade. Reads NOTHING on-chain — pair it with a contract/liquidity checker. Price: ${PRICE.intelProject}`,
    inputSchema: z.object({
      domain: z
        .string()
        .min(3)
        .max(253)
        .describe("Project website, e.g. \"example.org\""),
      tokenAddress: z
        .string()
        .min(20)
        .max(80)
        .optional()
        .describe("Optional contract address to cross-check against the site"),
      chain: z
        .string()
        .min(2)
        .max(32)
        .optional()
        .describe("Optional chain label, e.g. base, ethereum, solana"),
    }),
  },
  async ({ domain, tokenAddress, chain }) =>
    runTool("project due diligence", async () => {
      const res = await client.post("/intel/project", { domain, tokenAddress, chain });
      return jsonResult({
        project: res.data?.project,
        domain: res.data?.domain,
        site: res.data?.site,
        content: res.data?.content,
        crossCheck: res.data?.crossCheck,
        signals: res.data?.signals,
        risk: res.data?.risk,
        disclaimer: res.data?.disclaimer,
      });
    })
);

// Tool: Package intelligence
server.registerTool(
  "package_intel",
  {
    description: `Should you depend on this package? One call returns version, license, deprecation status WITH the maintainer's reason, weekly/monthly downloads, last release date, maintainer count, npm's quality/popularity/maintenance scores, and health signals (deprecated, no-recent-release, no-license, single-maintainer, no-public-repository). Supports npm and PyPI. Price: ${PRICE.package}`,
    inputSchema: z.object({
      name: z
        .string()
        .min(1)
        .max(214)
        .describe("Package name, e.g. \"express\" or \"@scope/pkg\""),
      registry: z
        .enum(["npm", "pypi"])
        .optional()
        .describe("Registry to look in (default npm)"),
    }),
  },
  async ({ name, registry }) =>
    runTool("package intel", async () => {
      const res = await client.post("/package", { name, registry });
      return jsonResult({
        name: res.data?.name,
        registry: res.data?.registry,
        version: res.data?.version,
        license: res.data?.license,
        repository: res.data?.repository,
        deprecated: res.data?.deprecated,
        deprecationReason: res.data?.deprecationReason,
        downloads: res.data?.downloads,
        maintenance: res.data?.maintenance,
        dependencies: res.data?.dependencies,
        signals: res.data?.signals,
      });
    })
);

// Tool: Technology detection
server.registerTool(
  "detect_tech",
  {
    description: `What a website is built and run on, from a single fetch: framework, CMS, ecommerce platform, CDN, analytics, payments, support widgets and web server — each reported with the response header or HTML marker that proves it. Use for competitive research, sales prospecting and vendor due diligence. Price: ${PRICE.tech}`,
    inputSchema: z.object({
      url: urlField.describe("Site URL to fingerprint"),
    }),
  },
  async ({ url }) =>
    runTool("detect tech", async () => {
      const res = await client.post("/tech", { url });
      return jsonResult({
        url: res.data?.finalUrl ?? res.data?.url,
        server: res.data?.server,
        poweredBy: res.data?.poweredBy,
        technologies: res.data?.technologies,
        categories: res.data?.categories,
      });
    })
);

// Tool: Hacker News discussions
server.registerTool(
  "search_discussions",
  {
    description: `What Hacker News said about a topic: matching stories with points, comment counts and links to the threads, plus aggregates — total matches, points and comments returned, most-submitted domains, and when it was first and last discussed. Price: ${PRICE.discussions}`,
    inputSchema: z.object({
      query: z.string().min(1).max(200).describe("What to search Hacker News for"),
      limit: z
        .number()
        .min(1)
        .max(50)
        .optional()
        .describe("Stories to return (1-50, default 10)"),
      sort: z
        .enum(["relevance", "recent"])
        .optional()
        .describe("Ranking (default relevance)"),
    }),
  },
  async ({ query, limit, sort }) =>
    runTool("search discussions", async () => {
      const res = await client.post("/discussions", { query, limit, sort });
      const stories = requireField(res.data?.stories, "stories");
      return jsonResult({ stories, summary: res.data?.summary });
    })
);

// Tool: Crawl site
server.registerTool(
  "crawl_site",
  {
    description: `Crawl a site and get clean markdown for every page in one synchronous call (no polling). Same-host BFS with depth and page-budget limits, robots.txt honoured by default. Price: ${PRICE.crawlPerPage} per requested page (1-25) — you are billed for the requested budget, not the pages returned`,
    inputSchema: z.object({
      url: urlField.describe("Start URL — the crawl stays on this host"),
      limit: z
        .number()
        .min(1)
        .max(25)
        .optional()
        .describe("Page budget (1-25, default: 10) — charged per requested page"),
      maxDepth: z
        .number()
        .min(0)
        .max(3)
        .optional()
        .describe("Link depth from the start URL (0-3, default: 2)"),
      include: pathFilterField.describe(
        "Only crawl URLs whose path+query contains one of these substrings"
      ),
      exclude: pathFilterField.describe(
        "Skip URLs whose path+query contains one of these substrings"
      ),
      respectRobots: z
        .boolean()
        .optional()
        .describe("Honour robots.txt (default: true; disable only for sites you control)"),
      maxChars: z
        .number()
        .min(500)
        .max(50000)
        .optional()
        .describe("Per-page content character cap (500-50000, default: 8000)"),
      timeout: timeoutField.describe("Per-page timeout in ms (5000-30000, default: 10000)"),
    }),
  },
  async ({ url, limit, maxDepth, include, exclude, respectRobots, maxChars, timeout }) =>
    runTool("crawl site", async () => {
      const res = await client.post("/crawl", {
        url,
        limit,
        maxDepth,
        include,
        exclude,
        respectRobots,
        maxChars,
        timeout,
      });
      const pages = requireField(res.data?.pages, "pages");
      return jsonResult({ pages, summary: res.data?.summary });
    })
);

// ============================================
// Intelligence
// ============================================

// Tool: Company intelligence
server.registerTool(
  "intel_company",
  {
    description: `Company intelligence deep dive: tech stack, funding, team, competitors, news. Price: ${PRICE.intelCompany}`,
    inputSchema: z.object({
      target: z
        .string()
        .min(1)
        .max(200)
        .describe("Company name or domain to research"),
    }),
  },
  async ({ target }) =>
    runTool("get company intelligence", async () => {
      const res = await client.post("/intel/company", { target });
      requireField(res.data?.name, "name");
      return jsonResult(res.data);
    })
);

// Tool: Market research
server.registerTool(
  "intel_market",
  {
    description: `AI-powered market research report with trends, key players, and data points. Price: ${PRICE.intelMarket}`,
    inputSchema: z.object({
      topic: queryField.describe("Market or industry topic to research"),
      depth: z
        .enum(["quick", "standard", "comprehensive"])
        .optional()
        .describe("Research depth (default: standard)"),
      focus: z.string().max(200).optional().describe("Optional focus area"),
    }),
  },
  async ({ topic, depth, focus }) =>
    runTool("run market research", async () => {
      const res = await client.post("/intel/market", { topic, depth, focus });
      requireField(res.data?.executiveSummary, "executiveSummary");
      return jsonResult(res.data);
    })
);

// Tool: Competitive analysis
server.registerTool(
  "intel_competitive",
  {
    description: `Competitive analysis: feature matrix, pricing, SWOT analysis. Price: ${PRICE.intelCompetitive}`,
    inputSchema: z.object({
      company: z.string().min(1).max(200).describe("Company to analyze"),
      maxCompetitors: z
        .number()
        .min(1)
        .max(10)
        .optional()
        .describe("Max competitors to include (1-10, default: 5)"),
      focus: z.string().max(200).optional().describe("Optional focus area"),
    }),
  },
  async ({ company, maxCompetitors, focus }) =>
    runTool("run competitive analysis", async () => {
      const res = await client.post("/intel/competitive", {
        company,
        maxCompetitors,
        focus,
      });
      requireField(res.data?.competitors, "competitors");
      return jsonResult(res.data);
    })
);

// Tool: Site audit
server.registerTool(
  "intel_site_audit",
  {
    description: `Comprehensive SEO, performance, and security audit with scoring. Price: ${PRICE.intelSiteAudit}`,
    inputSchema: z.object({
      url: urlField.describe("URL to audit"),
    }),
  },
  async ({ url }) =>
    runTool("audit site", async () => {
      const res = await client.post("/intel/site-audit", { url });
      requireField(res.data?.seoScore, "seoScore");
      return jsonResult(res.data);
    })
);

// ============================================
// Utility — monitoring & agent memory
// ============================================

// Tool: Create a change monitor
server.registerTool(
  "monitor_create",
  {
    description: `Create a URL change detection monitor with webhook notifications. Price: ${PRICE.monitorSetup}`,
    inputSchema: z.object({
      url: urlField.describe("URL to monitor for changes"),
      webhookUrl: urlField.describe("Webhook URL for change notifications"),
      checkInterval: z
        .number()
        .min(1)
        .max(24)
        .optional()
        .describe("Hours between checks (1-24, default: 1)"),
      notifyOn: z
        .enum(["any", "content", "status"])
        .optional()
        .describe("What triggers a notification (default: any)"),
    }),
  },
  async ({ url, webhookUrl, checkInterval, notifyOn }) =>
    runTool("create monitor", async () => {
      const res = await client.post("/monitor/create", {
        url,
        webhookUrl,
        checkInterval,
        notifyOn,
      });
      requireField(res.data?.monitorId, "monitorId");
      return jsonResult(res.data);
    })
);

// Tool: Store agent memory
server.registerTool(
  "memory_set",
  {
    description: `Store key-value data in persistent agent memory. Price: ${PRICE.memoryWrite}`,
    inputSchema: z.object({
      key: z.string().min(1).max(256).describe("Storage key (max 256 chars)"),
      value: z.unknown().describe("Value to store (any JSON)"),
      ttl: z
        .number()
        .min(1)
        .max(720)
        .optional()
        .describe("Time to live in hours (1-720, default: 168)"),
    }),
  },
  async ({ key, value, ttl }) =>
    runTool("store memory", async () => {
      const res = await client.post("/memory/set", { key, value, ttl });
      requireField(res.data?.key, "key");
      return jsonResult(res.data);
    })
);

// Start server
async function main() {
  // Initialize x402 payment client
  await initClient();
  console.error("WebLens MCP server: x402 v2 client initialized");

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("WebLens MCP server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
