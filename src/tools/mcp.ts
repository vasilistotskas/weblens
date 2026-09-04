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
const MCP_VERSION = "2025-06-18";

/**
 * Request headers a `tools/call` carries through onto the tool's own endpoint.
 *
 * The x402 payload, the three credit-account headers, and the caller's edge IP.
 * Only `Payment-Signature` used to be forwarded, so a buyer holding prepaid
 * credits could not spend them through MCP even though the identical call
 * worked over plain HTTP.
 *
 * Forwarding `cf-connecting-ip` is not a trust hole: the rate limiter reads
 * only that header *because* Cloudflare's edge overwrites it on the way in, so
 * the value copied here is the edge-set one from the outer request. Without it
 * every MCP-originated call to a free, rate-limited endpoint shares a single
 * "unknown" bucket and one noisy client throttles everyone.
 */
const FORWARDED_REQUEST_HEADERS = [
  "Payment-Signature",
  "X-CREDIT-WALLET",
  "X-CREDIT-SIGNATURE",
  "X-CREDIT-TIMESTAMP",
  "cf-connecting-ip",
] as const;

/**
 * Hono's ExecutionContext shape, taken from Context so it always agrees with
 * what `app.fetch` accepts — the global workers-types `ExecutionContext`
 * declares extra members (`tracing`, `abort`) that Hono's does not.
 */
type HonoExecutionContext = Context<{ Bindings: Env }>["executionCtx"];

/**
 * How a `tools/call` reaches WebLens' own endpoints.
 *
 * A tool call has to run the real middleware chain (validation -> credit ->
 * payment -> handler) so the x402 wall still issues the 402 and money moves
 * exactly as it does over plain HTTP. That used to be done with
 * `fetch(new URL(c.req.url).origin + endpoint)` — the Worker fetching its own
 * hostname — which cannot work here: WebLens runs on a Cloudflare **Custom
 * Domain** (`custom_domain = true` in wrangler.toml), and Cloudflare documents
 * that a Worker fetching its own hostname returns 522. Production agreed —
 * every `tools/call` answered `{"error":{"code":522}}`, free tools included,
 * from the day the self-fetch landed (2025-11) until this replaced it.
 *
 * Dispatching into the app's own fetch handler keeps the whole chain, spends no
 * subrequest, and removes the failure mode instead of working around it. The
 * documented alternative — the `global_fetch_strictly_public` compatibility
 * flag — keeps the round trip and bills a second Worker invocation per call.
 */
export type McpDispatcher = (
  request: Request,
  env: Env,
  ctx?: HonoExecutionContext
) => Response | Promise<Response>;

let mcpDispatcher: McpDispatcher | undefined;

/**
 * Registered by the Worker entry (`src/index.ts`) with the Hono app itself.
 * Accepts `undefined` so a test can assert the unregistered path directly.
 */
export function setMcpDispatcher(dispatcher: McpDispatcher | undefined): void {
  mcpDispatcher = dispatcher;
}

async function dispatchToolRequest(
  request: Request,
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  if (!mcpDispatcher) {
    // No entry point registered one. Throwing beats falling back to a
    // self-`fetch`, which is the bug this replaced.
    throw new Error(
      "MCP dispatcher not registered — the Worker entry must call setMcpDispatcher()"
    );
  }
  // `c.executionCtx` throws when the runtime supplied none; the cache
  // middleware already tolerates that, so pass it on only when it exists.
  let ctx: HonoExecutionContext | undefined;
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = undefined;
  }
  return mcpDispatcher(request, c.env, ctx);
}

/** Base64 -> JSON, for the `PAYMENT-REQUIRED` challenge header. */
function decodeBase64Json(value: string): unknown {
  try {
    const bytes = Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

/**
 * The JSON-RPC error for a tool call that still needs paying.
 *
 * x402 v2 carries the challenge in the base64 `PAYMENT-REQUIRED` *response
 * header* and leaves the 402 body as `{}`. Reading the body — which is what
 * this did — handed MCP clients an empty object: no amount, no asset, no
 * payTo, nothing signable. Return the decoded challenge, and the raw header
 * beside it so a client can pass it straight to an x402 client library.
 */
export function paymentRequiredError(
  response: Response,
  toolConfig: { endpoint: string; price: string }
): { code: number; message: string; data: Record<string, unknown> } {
  const header = response.headers.get("PAYMENT-REQUIRED");
  const challenge = header !== null ? decodeBase64Json(header) : undefined;

  return {
    code: 402,
    message: `Payment required: ${toolConfig.price} for ${toolConfig.endpoint}`,
    data: {
      endpoint: toolConfig.endpoint,
      price: toolConfig.price,
      ...(header !== null && { paymentRequiredHeader: header }),
      ...(challenge !== undefined && { paymentRequired: challenge }),
      howToPay:
        "Decode the base64 paymentRequiredHeader (or read the decoded paymentRequired), sign one " +
        "of its `accepts` entries with your wallet, then retry this tools/call with the signed " +
        "payload in the Payment-Signature header. Prepaid credits work too — send X-CREDIT-WALLET, " +
        "X-CREDIT-SIGNATURE and X-CREDIT-TIMESTAMP instead.",
    },
  };
}

/** Prefer the API's own error envelope over a bare body when a tool call fails. */
async function toolErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { code?: string; message?: string };
    if (parsed.message) {
      return parsed.code ? `${parsed.code}: ${parsed.message}` : parsed.message;
    }
  } catch {
    // Not an error envelope — fall through to the raw body.
  }
  return text;
}

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
    name: "domain_intel",
    description: `Everything about a domain in one call: who registered it and when, when it expires, its DNS records, the mail and DNS providers behind them, the SaaS vendors its TXT verification tokens reveal (Google Workspace, Microsoft 365, Salesforce, Atlassian, Okta, …), SPF/DMARC posture, and risk flags like newly-registered or no-registrar-lock. Use for vendor due diligence, security triage, phishing checks and prospect research. Price: ${PRICING.domain}`,
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Domain to inspect, e.g. \"stripe.com\". A full URL is reduced to its hostname." },
      },
      required: ["domain"],
    },
  },
  {
    name: "project_due_diligence",
    description: `Off-chain due diligence on a project's web presence — the half an on-chain rug checker cannot see. Returns domain age and registrar, whether a team page, whitepaper, docs and socials exist, whether the site is an off-the-shelf template, and a cross-check of a contract address against the addresses actually printed on the project's own website (a mismatch is a strong impersonation signal). Gives weighted risk signals and an A-F grade. Reads NOTHING on-chain — pair it with a contract/liquidity checker. Price: ${PRICING.intel.project}`,
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", minLength: 3, maxLength: 253, description: "Project website, e.g. \"example.org\"" },
        tokenAddress: { type: "string", minLength: 20, maxLength: 80, description: "Optional contract address to cross-check against the site" },
        chain: { type: "string", minLength: 2, maxLength: 32, description: "Optional chain label, e.g. base, ethereum, solana" },
      },
      required: ["domain"],
    },
  },
  {
    name: "package_intel",
    description: `Should you depend on this package? One call returns version, license, deprecation status WITH the maintainer's reason, weekly/monthly downloads, last release date, maintainer count, npm's quality/popularity/maintenance scores, and health signals (deprecated, no-recent-release, no-license, single-maintainer, no-public-repository). Supports npm and PyPI. Price: ${PRICING.package}`,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Package name, e.g. \"express\" or \"@scope/pkg\"" },
        registry: { type: "string", enum: ["npm", "pypi"], description: "Registry to look in (default npm)" },
      },
      required: ["name"],
    },
  },
  {
    name: "detect_tech",
    description: `What a website is built and run on, from a single fetch: framework, CMS, ecommerce platform, CDN, analytics, payments, support widgets and web server — each reported with the response header or HTML marker that proves it. Use for competitive research, sales prospecting and vendor due diligence. Price: ${PRICING.tech}`,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Site URL to fingerprint" },
      },
      required: ["url"],
    },
  },
  {
    name: "search_discussions",
    description: `What Hacker News said about a topic: matching stories with points, comment counts and links to the threads, plus aggregates — total matches, points and comments returned, most-submitted domains, and when it was first and last discussed. Price: ${PRICING.discussions}`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search Hacker News for" },
        limit: { type: "number", minimum: 1, maximum: 50, description: "Stories to return (default 10)" },
        sort: { type: "string", enum: ["relevance", "recent"], description: "Ranking (default relevance)" },
      },
      required: ["query"],
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
  domain_intel:      { endpoint: "/domain",          method: "POST", price: PRICING.domain },
  project_due_diligence: { endpoint: "/intel/project", method: "POST", price: PRICING.intel.project },
  package_intel:     { endpoint: "/package",         method: "POST", price: PRICING.package },
  detect_tech:       { endpoint: "/tech",            method: "POST", price: PRICING.tech },
  search_discussions:{ endpoint: "/discussions",     method: "POST", price: PRICING.discussions },
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

// Server identity, as the `serverInfo` object the initialize result requires.
// It must stay a nested object: clients read result.serverInfo.name.
const SERVER_INFO = {
  name: "weblens",
  version: "2.1.0",
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

  // A JSON-RPC request with no `id` is a notification and MUST NOT be
  // answered. MCP clients send `notifications/initialized` immediately after
  // the handshake; replying to it (previously with -32601, because only the
  // bare name "initialized" was handled) is a protocol violation that breaks
  // compliant clients. The caller turns null into a 202.
  if (id === undefined) {
    return null;
  }

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: MCP_VERSION,
          capabilities: SERVER_CAPABILITIES,
          serverInfo: SERVER_INFO,
        },
      };

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

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  for (const header of FORWARDED_REQUEST_HEADERS) {
    const value = c.req.header(header);
    if (value !== undefined) {
      headers[header] = value;
    }
  }

  try {
    const response = await dispatchToolRequest(
      new Request(new URL(toolConfig.endpoint, c.req.url), {
        method: toolConfig.method,
        headers,
        body: JSON.stringify(args),
      }),
      c
    );

    if (response.status === 402) {
      return {
        jsonrpc: "2.0",
        id,
        error: paymentRequiredError(response, toolConfig),
      };
    }

    if (!response.ok) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: response.status,
          message: await toolErrorMessage(response),
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
 * GET /mcp — decline the optional server-to-client SSE stream.
 *
 * Streamable HTTP lets a client open an SSE stream here so the server can push
 * requests and notifications unprompted. WebLens has nothing to push: every
 * tool call is a self-contained request/response paid at its own endpoint. The
 * spec covers exactly this case — the server "MUST respond with
 * Content-Type: text/event-stream or 405 Method Not Allowed" — so 405 is the
 * conformant answer, not a gap. Clients do try it (~1.5k GETs a week).
 *
 * Body is the standard error envelope like every other error the API returns;
 * MCP clients key off the status, so this only has to be consistent.
 */
export function mcpGetHandler(c: Context<{ Bindings: Env }>) {
  return c.json(
    {
      error: "METHOD_NOT_ALLOWED",
      code: "METHOD_NOT_ALLOWED",
      message:
        "This MCP endpoint does not offer a server-to-client SSE stream. " +
        "Send JSON-RPC requests as POST /mcp.",
      method: "GET",
      path: "/mcp",
      allowedMethods: ["POST"],
      requestId: c.get("requestId"),
    },
    405,
    { Allow: "POST" },
  );
}

/**
 * MCP info endpoint
 */
export function mcpInfoHandler(c: Context<{ Bindings: Env }>) {
  const baseUrl = new URL(c.req.url).origin;
  
  return c.json({
    name: "WebLens MCP Server",
    version: "2.1.0",
    tagline: "Scrape, crawl, map and extract the web — pay per call",
    description: "Web Intelligence API for AI agents with x402 micropayments. No API keys, no accounts, no monthly minimum - just pay per request with USDC on Base.",
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
