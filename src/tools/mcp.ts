/**
 * MCP (Model Context Protocol) HTTP Endpoint
 * Allows AI agents to connect via HTTP transport
 * 
 * Supports Streamable HTTP transport as per MCP spec
 */

import type { Context } from "hono";
import { PRICING } from "../config";
import { getPriceRange } from "../services/pricing";
import type { Env } from "../types";

// MCP Protocol version
const MCP_VERSION = "2025-03-26";

// Tool definitions for WebLens
// Exported for the MCP-contract test, which samples each tool's declared
// inputSchema and asserts the endpoint's canonical Zod schema accepts it.
export const TOOLS = [
  {
    name: "preview_endpoint",
    description: "FREE. See what a paid WebLens endpoint costs and what it returns before paying: the live price, a one-line summary, and a recorded sample of the exact response shape. Endpoints with no paid upstream (/fetch/basic, /contents, /map) also run a real truncated LIVE preview when you pass a url; SerpAPI- and Anthropic-backed endpoints return the recorded sample only, because free live runs there would burn upstream credits. Price: free",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string", description: "Paid endpoint path to preview, e.g. \"/answer\"" },
        url: { type: "string", description: "Fetch-backed endpoints only (/fetch/basic, /contents, /map): run a real truncated preview of this URL" },
      },
      required: ["endpoint"],
    },
  },
  {
    name: "fetch_webpage",
    description: `Fetch and convert a webpage to clean markdown. Fast, no JavaScript rendering. Price: ${PRICING.fetch.basic}`,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch" },
        timeout: { type: "number", minimum: 5000, maximum: 30000, description: "Request timeout in ms (default 10000)" },
        cache: { type: "boolean", description: "Serve from cache when available (default true; cached responses cost 70% less)" },
        cacheTtl: { type: "number", minimum: 60, maximum: 86400, description: "Cache TTL in seconds (default 3600)" },
      },
      required: ["url"],
    },
  },
  {
    name: "fetch_webpage_pro",
    description: `Fetch webpage with full JavaScript rendering. Use for SPAs and dynamic content. Price: ${PRICING.fetch.pro}`,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch" },
        waitFor: { type: "string", description: "CSS selector to wait for before capturing content (e.g. \".content\")" },
        timeout: { type: "number", minimum: 5000, maximum: 30000, description: "Request timeout in ms (default 15000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "screenshot",
    description: `Capture a screenshot of a webpage. Returns base64 PNG image. Price: ${PRICING.screenshot}`,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to screenshot" },
        width: { type: "number", minimum: 320, maximum: 3840, description: "Viewport width (default 1280)" },
        height: { type: "number", minimum: 240, maximum: 2160, description: "Viewport height (default 720)" },
        fullPage: { type: "boolean", description: "Capture full page scroll" },
      },
      required: ["url"],
    },
  },

  {
    name: "search_web",
    description: `Search the web and get real-time results with snippets. Set includeContent to also fetch the top result pages as markdown (+${PRICING.contents.perUrl}/result). Price: ${PRICING.search}`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Number of results (default: 10)" },
        includeContent: { type: "boolean", description: `Also fetch top result pages as markdown (+${PRICING.contents.perUrl}/result)` },
        contentResults: { type: "number", description: "How many top results to fetch content for (1-10, default: 5)" },
        contentChars: { type: "number", minimum: 500, maximum: 20000, description: "Per-page content character cap (default 8000)" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_news",
    description: `Search Google News for real-time articles with source, date, and thumbnail. Price: ${PRICING.searchVerticals.news}`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "News search query" },
        limit: { type: "number", description: "Number of results (default: 10, max: 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_images",
    description: `Search Google Images for direct image URLs with dimensions, thumbnails, and source pages. Price: ${PRICING.searchVerticals.images}`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Image search query" },
        limit: { type: "number", description: "Number of results (default: 10, max: 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_places",
    description: `Search local businesses via Google Local: names, addresses, ratings, reviews, phone, website, coordinates. Price: ${PRICING.searchVerticals.places}`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for (e.g. coffee shops)" },
        location: { type: "string", description: "Free-text location bias, e.g. \"Austin, Texas\"" },
        limit: { type: "number", description: "Number of results (default: 10, max: 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_shopping",
    description: `Search Google Shopping for products with prices, sellers, ratings, and links. Price: ${PRICING.searchVerticals.shopping}`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Product search query" },
        limit: { type: "number", description: "Number of results (default: 10, max: 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_scholar",
    description: `Search Google Scholar for academic papers with snippets, publication info, and citation counts. Price: ${PRICING.searchVerticals.scholar}`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Academic search query" },
        limit: { type: "number", description: "Number of results (default: 10, max: 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_autocomplete",
    description: `Get Google Autocomplete suggestions for a partial query — keyword research and intent discovery. Price: ${PRICING.searchVerticals.autocomplete}`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Partial query to complete" },
        limit: { type: "number", description: "Max suggestions (default: 10, max: 20)" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_trends",
    description: `Get Google Trends interest-over-time timeline for a query. Price: ${PRICING.searchVerticals.trends}`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Topic to get trend data for" },
      },
      required: ["query"],
    },
  },
  {
    name: "youtube_transcript",
    description: `Get the full transcript of a YouTube video with timestamps. Accepts a video ID or any YouTube URL. Price: ${PRICING.youtubeTranscript}`,
    inputSchema: {
      type: "object",
      properties: {
        videoId: { type: "string", description: "YouTube video ID (e.g. dQw4w9WgXcQ) or full video URL" },
        lang: { type: "string", description: "Transcript language code (default: video default)" },
      },
      required: ["videoId"],
    },
  },
  {
    name: "get_contents",
    description: `Fetch 1-20 URLs and get clean markdown per page, truncated to a character cap. Price: ${PRICING.contents.perUrl}/URL`,
    inputSchema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" }, description: "URLs to fetch (1-20)" },
        maxChars: { type: "number", minimum: 500, maximum: 50000, description: "Per-page content character cap (default 20000)" },
        timeout: { type: "number", minimum: 5000, maximum: 30000, description: "Per-URL timeout in ms (default 10000)" },
      },
      required: ["urls"],
    },
  },
  {
    name: "answer_question",
    description: `Get a grounded answer with inline [n] citations: searches the web, fetches sources, and answers strictly from them. Price: ${PRICING.answer}`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The question to answer" },
        sources: { type: "number", description: "Web sources to search, fetch, and cite (1-5, default: 3)" },
      },
      required: ["query"],
    },
  },
  {
    name: "extract_data",
    description: `Extract structured data from a webpage using a JSON schema. AI-powered extraction. Price: ${PRICING.extract}`,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to extract from" },
        schema: { type: "object", description: "JSON schema defining the data structure to extract" },
        instructions: { type: "string", description: "Natural language instructions to guide extraction" },
      },
      required: ["url", "schema"],
    },
  },
  {
    name: "smart_extract",
    description: `Extract data using natural language. AI understands what you want. Price: ${PRICING.smartExtract}`,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to extract from" },
        query: { type: "string", description: "What data to extract (natural language)" },
      },
      required: ["url", "query"],
    },
  },
  {
    name: "research",
    description: `One-stop research: searches web, fetches top results, and summarizes findings. Price: ${PRICING.research}`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Research topic or question" },
        resultCount: { type: "number", description: "Number of sources to analyze (default: 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "deep_research",
    description: `Multi-step cited research in one call: plans sub-questions, searches each, fetches and dedupes sources, then synthesizes an answer with inline [n] citations, key findings, and gaps. Unlike \`research\` (${PRICING.research}, one search + summary) this decomposes the question and cites every claim. SLOW: a standard run takes ~30-60 seconds — use a generous client timeout and do not retry on timeout. Price: ${PRICING.deepResearch.standard} standard (3 sub-questions, 8 sources) / ${PRICING.deepResearch.deep} deep (5 sub-questions, 12 sources)`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The research question (1-500 chars)" },
        depth: { type: "string", enum: ["standard", "deep"], description: `Research tier: standard = 3 sub-questions / 8 sources (${PRICING.deepResearch.standard}); deep = 5 / 12 (${PRICING.deepResearch.deep}). Default: standard` },
      },
      required: ["query"],
    },
  },
  {
    name: "extract_pdf",
    description: `Extract text and metadata from a PDF document. Price: ${PRICING.pdf}`,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL of the PDF to extract" },
      },
      required: ["url"],
    },
  },
  {
    name: "compare_urls",
    description: `Compare 2-3 webpages and get AI-generated analysis of differences. Price: ${PRICING.compare}`,
    inputSchema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" }, description: "URLs to compare (2-3)" },
        focus: { type: "string", description: "What to focus comparison on" },
      },
      required: ["urls"],
    },
  },
  {
    name: "batch_fetch",
    description: `Fetch multiple URLs in parallel. Efficient for bulk operations. Price: ${PRICING.batchFetch.perUrl}/URL`,
    inputSchema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" }, description: "URLs to fetch (2-20)" },
      },
      required: ["urls"],
    },
  },
  {
    name: "map_site",
    description: `Discover a site's URLs without fetching page content — reads robots.txt sitemap directives, sitemap.xml and nested sitemap indexes, falling back to homepage link extraction. Price: ${PRICING.map}`,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Site URL to map" },
        limit: { type: "number", description: "Maximum URLs to return (1-5000, default: 1000)" },
        include: { type: "array", items: { type: "string" }, description: "Only URLs whose path+query contains one of these substrings" },
        exclude: { type: "array", items: { type: "string" }, description: "Skip URLs whose path+query contains one of these substrings" },
        timeout: { type: "number", minimum: 5000, maximum: 30000, description: "Timeout in ms (default 10000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "crawl_site",
    description: `Crawl a site and get clean markdown for every page in one synchronous call (no polling). Same-host BFS with depth and page-budget limits, robots.txt honoured by default. Price: ${PRICING.crawl.perPage} per requested page (${String(PRICING.crawl.minPages)}-${String(PRICING.crawl.maxPages)}) — you are billed for the requested budget, not the pages returned`,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Start URL — the crawl stays on this host" },
        limit: { type: "number", description: `Page budget (${String(PRICING.crawl.minPages)}-${String(PRICING.crawl.maxPages)}, default: 10) — charged per requested page` },
        maxDepth: { type: "number", description: "Link depth from the start URL (0-3, default: 2)" },
        include: { type: "array", items: { type: "string" }, description: "Only crawl URLs whose path+query contains one of these substrings" },
        exclude: { type: "array", items: { type: "string" }, description: "Skip URLs whose path+query contains one of these substrings" },
        respectRobots: { type: "boolean", description: "Honour robots.txt (default: true; disable only for sites you control)" },
        maxChars: { type: "number", minimum: 500, maximum: 50000, description: "Per-page content character cap (default 8000)" },
        timeout: { type: "number", minimum: 5000, maximum: 30000, description: "Per-page timeout in ms (default 10000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "fetch_resilient",
    description: `Resilient fetch with automatic fallback: native scraper first, then headless Chromium for JS-rendered or bot-walled pages. Price: ${PRICING.fetch.resilient}`,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch" },
        timeout: { type: "number", minimum: 5000, maximum: 30000, description: "Timeout in ms (default 10000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "intel_company",
    description: `Company intelligence deep dive: tech stack, funding, team, competitors, news. Price: ${PRICING.intel.company}`,
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Company name or domain to research" },
      },
      required: ["target"],
    },
  },
  {
    name: "intel_market",
    description: `AI-powered market research report with trends, key players, and data points. Price: ${PRICING.intel.market}`,
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Market or industry topic to research" },
        depth: { type: "string", enum: ["quick", "standard", "comprehensive"], description: "Research depth (default standard)" },
        focus: { type: "string", description: "Optional focus area" },
      },
      required: ["topic"],
    },
  },
  {
    name: "intel_competitive",
    description: `Competitive analysis: feature matrix, pricing, SWOT analysis. Price: ${PRICING.intel.competitive}`,
    inputSchema: {
      type: "object",
      properties: {
        company: { type: "string", description: "Company to analyze" },
        maxCompetitors: { type: "number", description: "Max competitors to include (default: 5)" },
        focus: { type: "string", description: "Optional focus area" },
      },
      required: ["company"],
    },
  },
  {
    name: "intel_site_audit",
    description: `Comprehensive SEO, performance, and security audit with scoring. Price: ${PRICING.intel.siteAudit}`,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to audit" },
      },
      required: ["url"],
    },
  },
  {
    name: "monitor_create",
    description: `Create a URL change detection monitor with webhook notifications. Price: ${PRICING.monitor.setup}`,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to monitor for changes" },
        webhookUrl: { type: "string", description: "Webhook URL for change notifications" },
      },
      required: ["url", "webhookUrl"],
    },
  },
  {
    name: "memory_set",
    description: `Store key-value data in persistent agent memory. Price: ${PRICING.memory.write}`,
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Storage key (max 256 chars)" },
        value: { description: "Value to store (any JSON)" },
        ttl: { type: "number", description: "Time to live in hours (1-720, default: 168)" },
      },
      required: ["key", "value"],
    },
  },
];

// MCP tool name → REST endpoint, method, and price.
// Single source of truth used by both `tools/call` (to forward the request to
// the right HTTP endpoint) and `/mcp/info` (to expose structured pricing).
// `Partial<Record<...>>` lets us safely index by an unknown tool name and
// branch on undefined for unknown tools.
export const TOOL_ENDPOINTS: Partial<Record<string, { endpoint: string; method: string; price: string }>> = {
  preview_endpoint:  { endpoint: "/preview",         method: "POST", price: "free" },
  fetch_webpage:     { endpoint: "/fetch/basic",     method: "POST", price: PRICING.fetch.basic },
  fetch_webpage_pro: { endpoint: "/fetch/pro",       method: "POST", price: PRICING.fetch.pro },
  fetch_resilient:   { endpoint: "/fetch/resilient", method: "POST", price: PRICING.fetch.resilient },
  screenshot:        { endpoint: "/screenshot",      method: "POST", price: PRICING.screenshot },
  search_web:        { endpoint: "/search",          method: "POST", price: PRICING.search },
  search_news:       { endpoint: "/search/news",     method: "POST", price: PRICING.searchVerticals.news },
  search_images:     { endpoint: "/search/images",   method: "POST", price: PRICING.searchVerticals.images },
  search_places:     { endpoint: "/search/places",   method: "POST", price: PRICING.searchVerticals.places },
  search_shopping:   { endpoint: "/search/shopping", method: "POST", price: PRICING.searchVerticals.shopping },
  search_scholar:    { endpoint: "/search/scholar",  method: "POST", price: PRICING.searchVerticals.scholar },
  search_autocomplete: { endpoint: "/search/autocomplete", method: "POST", price: PRICING.searchVerticals.autocomplete },
  search_trends:     { endpoint: "/search/trends",   method: "POST", price: PRICING.searchVerticals.trends },
  youtube_transcript: { endpoint: "/social/youtube/transcript", method: "POST", price: PRICING.youtubeTranscript },
  get_contents:      { endpoint: "/contents",        method: "POST", price: PRICING.contents.perUrl },
  answer_question:   { endpoint: "/answer",          method: "POST", price: PRICING.answer },
  extract_data:      { endpoint: "/extract",         method: "POST", price: PRICING.extract },
  smart_extract:     { endpoint: "/extract/smart",   method: "POST", price: PRICING.smartExtract },
  research:          { endpoint: "/research",        method: "POST", price: PRICING.research },
  deep_research:     { endpoint: "/research/deep",   method: "POST", price: `${PRICING.deepResearch.standard}-${PRICING.deepResearch.deep}` },
  batch_fetch:       { endpoint: "/batch/fetch",     method: "POST", price: PRICING.batchFetch.perUrl },
  map_site:          { endpoint: "/map",             method: "POST", price: PRICING.map },
  crawl_site:        { endpoint: "/crawl",           method: "POST", price: `${PRICING.crawl.perPage}/page` },
  extract_pdf:       { endpoint: "/pdf",             method: "POST", price: PRICING.pdf },
  compare_urls:      { endpoint: "/compare",         method: "POST", price: PRICING.compare },
  monitor_create:    { endpoint: "/monitor/create",  method: "POST", price: PRICING.monitor.setup },
  memory_set:        { endpoint: "/memory/set",      method: "POST", price: PRICING.memory.write },
  intel_company:     { endpoint: "/intel/company",   method: "POST", price: PRICING.intel.company },
  intel_market:      { endpoint: "/intel/market",    method: "POST", price: PRICING.intel.market },
  intel_competitive: { endpoint: "/intel/competitive", method: "POST", price: PRICING.intel.competitive },
  intel_site_audit:  { endpoint: "/intel/site-audit", method: "POST", price: PRICING.intel.siteAudit },
};

// Server info
const SERVER_INFO = {
  name: "weblens",
  version: "2.0.0",
  protocolVersion: MCP_VERSION,
};

// Server capabilities
const SERVER_CAPABILITIES = {
  tools: {},
};

/**
 * Handle MCP JSON-RPC requests
 */
interface JsonRpcRequest {
  method: string;
  params?: Record<string, unknown>;
  id?: string | number;
}

type JsonRpcResponse = {
  jsonrpc: string;
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
} | null;

async function handleJsonRpc(request: JsonRpcRequest, c: Context<{ Bindings: Env }>): Promise<JsonRpcResponse> {
  const { method, id } = request;
  const params = request.params;

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          ...SERVER_INFO,
          capabilities: SERVER_CAPABILITIES,
        },
      };

    case "initialized":
      return null;

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: TOOLS,
        },
      };

    case "tools/call": {
      const toolParams = params as ToolCallParams | undefined;
      if (!toolParams?.name) {
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32602,
            message: "Missing tool name in params",
          },
        };
      }
      return await handleToolCall(toolParams, id, c);
    }

    case "ping":
      return {
        jsonrpc: "2.0",
        id,
        result: {},
      };

    default:
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      };
  }
}


/**
 * Handle tool calls - returns 402 for payment
 */
interface ToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

async function handleToolCall(params: ToolCallParams, id: string | number | undefined, c: Context<{ Bindings: Env }>): Promise<JsonRpcResponse> {
  const { name, arguments: args } = params;
  const paymentSignature = c.req.header("Payment-Signature");

  const toolConfig = TOOL_ENDPOINTS[name];
  if (!toolConfig) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32602,
        message: `Unknown tool: ${name}`,
      },
    };
  }

  const baseUrl = new URL(c.req.url).origin;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(paymentSignature && { "Payment-Signature": paymentSignature }),
  };

  try {
    const response = await fetch(`${baseUrl}${toolConfig.endpoint}`, {
      method: toolConfig.method,
      headers,
      body: JSON.stringify(args),
    });

    if (response.status === 402) {
      const paymentInfo: unknown = await response.json();
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: 402,
          message: "Payment Required",
          data: paymentInfo,
        },
      };
    }

    if (!response.ok) {
      const errorText = await response.text();
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: response.status,
          message: errorText,
        },
      };
    }

    const result: unknown = await response.json();
    const paymentResponse = response.headers.get("PAYMENT-RESPONSE");

    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        ...(paymentResponse && { _meta: { "x402/payment-response": paymentResponse } }),
      },
    };
  } catch (error) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: `Internal error: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
    };
  }
}

/**
 * MCP HTTP POST handler
 */
export async function mcpPostHandler(c: Context<{ Bindings: Env }>) {
  const contentType = c.req.header("Content-Type");
  
  if (!contentType?.includes("application/json")) {
    return c.json({ error: "Content-Type must be application/json" }, 400);
  }

  try {
    const jsonRequest: JsonRpcRequest = await c.req.json();
    const response = await handleJsonRpc(jsonRequest, c);

    if (response === null) {
      return new Response(null, { status: 202 });
    }

    return c.json(response, 200, {
      "MCP-Protocol-Version": MCP_VERSION,
    });
  } catch {
    return c.json({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: "Parse error",
      },
    }, 400);
  }
}

/**
 * MCP HTTP GET handler (for SSE streams - not implemented yet)
 */
export function mcpGetHandler() {
  return new Response("Method Not Allowed", { 
    status: 405,
    headers: {
      "Allow": "POST",
    },
  });
}

/**
 * MCP info endpoint
 */
export function mcpInfoHandler(c: Context<{ Bindings: Env }>) {
  const baseUrl = new URL(c.req.url).origin;
  
  return c.json({
    name: "WebLens MCP Server",
    version: "2.0.0",
    tagline: "Give your AI agents web superpowers",
    description: "Web Intelligence API for AI agents with x402 micropayments. No API keys, no accounts - just pay per request with USDC on Base.",
    protocolVersion: MCP_VERSION,
    transport: "streamable-http",
    capabilities: [
      "free-previews",
      "web-scraping",
      "javascript-rendering",
      "screenshot-capture",
      "web-search",
      "news-search",
      "image-search",
      "local-business-data",
      "shopping-search",
      "academic-search",
      "keyword-autocomplete",
      "trend-analysis",
      "youtube-transcripts",
      "grounded-answers",
      "deep-research",
      "cited-research",
      "bulk-page-contents",
      "site-mapping",
      "sitemap-discovery",
      "web-crawling",
      "data-extraction",
      "ai-powered-analysis",
      "pdf-extraction",
      "batch-operations",
      "url-monitoring",
      "persistent-memory",
      "url-comparison",
      "web-intelligence",
    ],
    // Each tool exposes its REST endpoint and price as structured fields
    // (in addition to the natural-language description) so callers can
    // discover pricing programmatically without parsing the description.
    tools: TOOLS.map(t => {
      const ep = TOOL_ENDPOINTS[t.name];
      return {
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        ...(ep && { path: ep.endpoint, method: ep.method, price: ep.price }),
      };
    }),
    pricing: {
      currency: "USDC",
      network: "base",
      protocol: "x402",
      range: getPriceRange(),
      noFees: true,
      instantSettlement: true,
    },
    integration: {
      remote: `${baseUrl}/mcp`,
      local: "npx -y @weblens/mcp",
    },
    documentation: {
      interactive: `${baseUrl}/docs`,
      openapi: `${baseUrl}/openapi.json`,
      llms: `${baseUrl}/llms.txt`,
      discovery: `${baseUrl}/discovery`,
    },
    x402: {
      version: 2,
      facilitator: "payai+cdp",
      bazaarListed: false,
    },
  });
}
