/**
 * WebLens Configuration
 * Pricing, facilitators, and cache settings
 */

// Unified pricing configuration for all endpoints
// Requirements: 1.4, 2.6, 3.5, 4.2, 4.4, 5.4, 6.4, 7.2
/**
 * COST BASIS (verified against Cloudflare's published rates, 2026-08).
 *
 * Workers Standard bills requests at $0.30/million ($0.0000003 each) and CPU
 * at $0.02/million CPU-ms ($0.00000002 each), and explicitly does NOT bill
 * subrequests. So a native fetch endpoint costs us ~$0.000001-0.00002 per
 * call: the price is essentially all margin, and the only real floor is what
 * the market will bear.
 *
 * Browser Rendering bills $0.09 per browser-hour ($0.000025/browser-second)
 * beyond 10 free hours/month, so a 5-20s render costs $0.000125-0.0005.
 *
 * The endpoints with a REAL cost floor are the ones calling a paid upstream:
 * SerpAPI ($0.009-0.015/search) and Anthropic. Those keep their prices; see
 * the search floor rule below.
 *
 * Market reference (2026): Exa $0.007/request, Tavily $0.0075-0.008, and
 * Firecrawl ~$0.001/page but only on a $99/mo commitment. WebLens undercuts
 * on the zero-cost endpoints while requiring no subscription at all.
 */
export const PRICING = {
  // Core endpoints. Browser-backed prices (screenshot, fetch.pro) still clear
  // their ~$0.0005 worst-case render cost by more than 10x.
  screenshot: "$0.008",
  fetch: {
    basic: "$0.002",
    pro: "$0.006",
    resilient: "$0.008", // native first, Browser Rendering fallback
  },
  // Search pricing floor: every SerpAPI-backed call costs $0.009-$0.015
  // upstream depending on plan tier — prices below $0.015 would sell at a
  // loss on the worst-case plan rate.
  search: "$0.015",
  searchVerticals: {
    news: "$0.015",
    images: "$0.015",
    places: "$0.045",   // market anchor: StableEnrich sells Maps-backed places at $0.045
    shopping: "$0.015",
    scholar: "$0.015",
    autocomplete: "$0.015",
    trends: "$0.015",
  },
  // Per-result page-content addon for search (includeContent) and the
  // standalone /contents endpoint. Native fetch has ~zero marginal cost.
  contents: {
    perUrl: "$0.0015",
    minUrls: 1,
    maxUrls: 20,
  },
  youtubeTranscript: "$0.03", // 1 SerpAPI call upstream; StableSocial sells transcripts at $0.06
  answer: "$0.05", // ~$0.026 worst-case upstream (1 SerpAPI call + capped Haiku tokens)
  extract: "$0.03",
  cacheDiscount: 0.7, // 70% off for cached responses

  // Batch fetch pricing
  batchFetch: {
    perUrl: "$0.0015",
    minUrls: 2,
    maxUrls: 20,
  },

  // Site URL discovery (sitemap/robots/link based). A handful of subrequests
  // regardless of site size, so a flat price stays profitable.
  map: "$0.004",

  // Domain intelligence: RDAP registration + DNS posture + derived signals.
  // Both upstreams (IANA/registry RDAP, Cloudflare DoH) are free, so this is
  // another ~$0.000002 call. Priced against what it replaces: WhoisXML's
  // entry tier works out to $0.015/query on a $30/mo minimum, BuiltWith gates
  // its API behind $495/mo, and the incumbent x402 seller charges $0.04 for a
  // composed report or $0.005-0.01 per fragment. One call, all of it, less.
  domain: "$0.005",

  // The rest of the zero-upstream-cost family. Each replaces a lookup that is
  // otherwise only sold on a subscription, or not sold at all:
  //   /package     npm + PyPI health in one call (registries are free)
  //   /tech        site tech stack from headers + HTML — the other half of
  //                what BuiltWith gates behind $295/mo
  //   /discussions Hacker News via the free Algolia index
  package: "$0.003",
  tech: "$0.005",
  discussions: "$0.004",

  // Bounded whole-site crawl. Priced per requested page (the page budget the
  // caller reserves), consistent with batch fetch. Native fetch + markdown,
  // so marginal cost is CPU only.
  crawl: {
    perPage: "$0.0015",
    minPages: 1,
    maxPages: 25,
  },

  // Research endpoint
  research: "$0.08",

  // Multi-step deep research (plan -> search per sub-question -> fetch ->
  // cited synthesis). Worst-case upstream cost per tier, at SerpAPI's
  // $0.015/search ceiling and Haiku 4.5 at $1/$5 per MTok:
  //   standard: 3 searches ($0.045) + ~$0.02 AI = ~$0.065  -> $0.20 (3x)
  //   deep:     5 searches ($0.075) + ~$0.03 AI = ~$0.105  -> $0.35 (3.3x)
  // Changing DEEP_RESEARCH_TIERS in services/deep-research.ts changes those
  // ceilings — reprice here if you do.
  deepResearch: {
    standard: "$0.20",
    deep: "$0.35",
  },

  // Smart extraction (AI-powered, higher cost)
  smartExtract: "$0.035",

  // URL monitoring
  monitor: {
    setup: "$0.01",
    perCheck: "$0.001",
    minInterval: 1,   // hours
    maxInterval: 24,  // hours
  },

  // PDF extraction — native fetch + parse, no AI call (see tools/pdf.ts)
  pdf: "$0.004",

  // URL comparison
  compare: "$0.05",

  // Agent memory storage
  memory: {
    write: "$0.001",
    read: "$0.0005",
    minTtl: 1,        // hours
    maxTtl: 720,      // 30 days
    defaultTtl: 168,  // 7 days
  },

  // Intelligence endpoints (Knowledge Arbitrageur)
  // Premium pricing — chains multiple tools + AI into structured intelligence.
  // Still 50–100× cheaper than Semrush/Similarweb/Crunchbase APIs.
  intel: {
    company: "$1.00",       // Company deep dive
    market: "$5.00",        // Market research report
    competitive: "$8.00",   // Competitive analysis
    siteAudit: "$0.75",     // Full site audit
    /**
     * Off-chain project due diligence. Priced against the market it sells
     * into rather than the cost to serve: on the x402 rail, crypto risk
     * data goes for $0.02 (rug check) to $0.50 (full due diligence), and
     * every incumbent there reads only the chain. This reads only the web,
     * so it is the complement rather than a competitor — priced between the
     * cheap grade and the full report. Cost to serve is the usual
     * ~$0.000002: RDAP, DNS and one page fetch, all free upstreams.
     */
    project: "$0.05",
  },

  // Agent Credit Accounts (Clearing House seed)
  credits: {
    tiers: [
      { minDeposit: "$10", bonus: 0.20 },   // 20% bonus
      { minDeposit: "$50", bonus: 0.30 },   // 30% bonus
      { minDeposit: "$100", bonus: 0.40 },  // 40% bonus
    ],
  },
} as const;

// Paid POST endpoints. Used by the POST-only enforcement middleware
// (src/index.ts) and by request validation: unauthenticated probes of these
// paths fall through to the x402 402 challenge instead of a 400, so agents
// that probe without reading the spec still discover a payable resource.
export const PAID_ENDPOINTS: readonly string[] = [
  "/fetch/basic", "/fetch/pro", "/fetch/resilient", "/screenshot", "/search", "/extract",
  "/batch/fetch", "/research", "/extract/smart", "/pdf", "/compare",
  "/monitor/create", "/memory/set", "/credits/buy",
  "/intel/company", "/intel/market", "/intel/competitive", "/intel/site-audit",
  "/search/news", "/search/images", "/search/places", "/search/shopping",
  "/search/scholar", "/search/autocomplete", "/search/trends",
  "/social/youtube/transcript", "/contents", "/answer",
  "/map", "/crawl", "/research/deep", "/domain",
  "/package", "/tech", "/discussions", "/intel/project",
];

// Routes published with a `{param}` placeholder, paired with a URL a caller can
// actually issue.
//
// Agents copy documented paths verbatim, braces and all: production logs showed
// ~10.8k requests a week to literal `/r/{url}`, `/receipts/{requestId}` and
// friends (they arrive percent-encoded as `%7Burl%7D`; Hono decodes them back to
// braces in `c.req.path`). Every one was a dead end — a 404, or a 400 whose
// message said nothing about the real mistake.
//
// This is the single source of truth for those templates. `pathTemplateMiddleware`
// answers an unsubstituted request with the matching `example`, and
// `tests/unit/path-templates.test.ts` asserts that every `{param}` string
// reachable in the published discovery surfaces appears here — so a new
// parameterized route cannot ship without its example.
export interface ParameterizedRoute {
  /** Exactly as published to agents, e.g. "/r/{url}". */
  readonly template: string;
  readonly methods: readonly string[];
  /** Placeholder name, e.g. "url". */
  readonly param: string;
  /** A path the caller can issue as-is. */
  readonly example: string;
  /** Where the real value comes from. */
  readonly hint: string;
  /**
   * Whether `example` resolves for anyone, right now.
   *
   * True when the parameter is caller-supplied (`/r/`, `/s/`), so the example
   * is a live call and can be published as *the* endpoint. False when the
   * parameter is an id this service issued (a receipt, a stored feedback
   * document, a monitor) — the example is then illustrative only, would 404
   * for anyone else, and must never be published in a field consumers
   * dereference. Those routes advertise `uriTemplate` and nothing fetchable.
   */
  readonly callableExample: boolean;
}

export const PARAMETERIZED_ROUTES: readonly ParameterizedRoute[] = [
  {
    template: "/r/{url}",
    methods: ["GET"],
    param: "url",
    example: "/r/https://example.com",
    hint: "Append the full target URL, scheme included, exactly as-is — do not encode it.",
    callableExample: true,
  },
  {
    template: "/s/{query}",
    methods: ["GET"],
    param: "query",
    example: "/s/cloudflare+workers",
    hint: "Append the search query, using + or %20 between words.",
    callableExample: true,
  },
  {
    template: "/receipts/{requestId}",
    methods: ["GET"],
    param: "requestId",
    example: "/receipts/6f9619ff-8b86-d011-b42d-00cf4fc964ff",
    hint: "Use the requestId from the paid response body, or the X-Receipt-Id response header.",
    callableExample: false,
  },
  {
    template: "/feedback/{id}",
    methods: ["GET"],
    param: "id",
    example: "/feedback/6f9619ff-8b86-d011-b42d-00cf4fc964ff",
    hint: "Use the id from the feedbackURI returned by POST /feedback.",
    callableExample: false,
  },
  {
    template: "/monitor/{id}",
    methods: ["GET", "DELETE"],
    param: "id",
    example: "/monitor/6f9619ff-8b86-d011-b42d-00cf4fc964ff",
    hint: "Use the monitor id returned by POST /monitor/create.",
    callableExample: false,
  },
];

const EXAMPLE_BY_TEMPLATE = new Map(PARAMETERIZED_ROUTES.map((route) => [route.template, route.example]));

/**
 * The callable example for a published template, for the discovery surfaces to
 * advertise alongside it. Throws on an unregistered template so a new
 * parameterized route fails at import rather than shipping without an example.
 */
export function pathExample(template: string): string {
  const example = EXAMPLE_BY_TEMPLATE.get(template);
  if (example === undefined) {
    throw new Error(`No example registered in PARAMETERIZED_ROUTES for path template ${template}`);
  }
  return example;
}

const ROUTE_BY_TEMPLATE_CONFIG = new Map(PARAMETERIZED_ROUTES.map((route) => [route.template, route]));

/** How a parameterized route is published in a machine-readable catalog. */
export interface PathPublication {
  /**
   * A path that resolves as-is. Present only for `callableExample` routes —
   * the field a naive consumer dereferences must always be fetchable, which is
   * the whole point of this shape.
   */
  readonly endpoint?: string;
  /** RFC 6570 template. Expand the placeholder; never request it literally. */
  readonly uriTemplate: string;
  /** Illustrative call, whether or not it resolves for the reader. */
  readonly example: string;
}

/**
 * Publication shape for a parameterized route, for any catalog an agent reads.
 *
 * Exists because agents dereference whatever looks like a URL. Publishing
 * `endpoint: "/r/{url}"` sent ~44k requests a week to the literal brace string;
 * the template belongs in a field whose name says it is a template, and
 * `endpoint` belongs only to paths that actually answer. Prefix with an origin
 * for absolute URLs.
 */
export function pathPublication(template: string): PathPublication {
  const route = ROUTE_BY_TEMPLATE_CONFIG.get(template);
  if (route === undefined) {
    throw new Error(`No entry in PARAMETERIZED_ROUTES for path template ${template}`);
  }
  return {
    ...(route.callableExample ? { endpoint: route.example } : {}),
    uriTemplate: route.template,
    example: route.example,
  };
}

/** {@link pathPublication} with every path resolved against an origin. */
export function absolutePathPublication(origin: string, template: string): PathPublication {
  const relative = pathPublication(template);
  return {
    ...(relative.endpoint === undefined ? {} : { endpoint: `${origin}${relative.endpoint}` }),
    uriTemplate: `${origin}${relative.uriTemplate}`,
    example: `${origin}${relative.example}`,
  };
}

// Free tier configuration - rate-limited access without payment
export const FREE_TIER = {
  // Rate limiting
  maxRequestsPerHour: 10,
  rateLimitWindowSeconds: 3600, // 1 hour
  kvKeyPrefix: "ratelimit",

  // Content limits
  fetchMaxContentLength: 2000, // chars
  searchMaxResults: 3,
} as const;

// CAIP-2 chain identifiers for every network WebLens can be paid on.
//
// Facilitator selection is NOT configured here — it happens at runtime in
// src/middleware/payment.ts based on env vars (NETWORK, CDP_API_KEY_ID,
// CDP_API_KEY_SECRET, FACILITATOR_URL, PAYAI_FACILITATOR_URL). See
// getResourceServer() in payment.ts for the full branch logic.
//
// The Solana ids are the genesis-hash prefixes CAIP-2 mandates, and match
// what facilitator.payai.network/supported advertises for `exact`.
export const NETWORKS = {
  baseMainnet: "eip155:8453",
  baseSepolia: "eip155:84532",
  solanaMainnet: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  solanaDevnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
} as const;

/** The env fields that decide which networks are live. */
export interface NetworkEnv {
  NETWORK?: string;
  PAY_TO_ADDRESS_SVM?: string;
}

/** True on the testnet deployment (Base Sepolia + Solana devnet). */
export function isTestnet(env: NetworkEnv): boolean {
  return env.NETWORK === "base-sepolia";
}

/** The EVM chain this deployment settles on. */
export function evmNetwork(env: NetworkEnv): `${string}:${string}` {
  return isTestnet(env) ? NETWORKS.baseSepolia : NETWORKS.baseMainnet;
}

/**
 * The Solana chain this deployment settles on, or undefined when Solana is off.
 *
 * Gated on a configured `PAY_TO_ADDRESS_SVM` because an SVM `exact` payment is
 * an SPL TransferChecked into the payee's associated token account, and the
 * spec makes the facilitator verify that the destination account exists.
 * Advertising Solana without a real USDC-initialised address would hand every
 * buyer a challenge whose settlement cannot succeed.
 */
export function svmNetwork(env: NetworkEnv): `${string}:${string}` | undefined {
  if (!env.PAY_TO_ADDRESS_SVM?.trim()) {return undefined;}
  return isTestnet(env) ? NETWORKS.solanaDevnet : NETWORKS.solanaMainnet;
}

/**
 * Networks advertised on discovery surfaces, in CAIP-2 form.
 *
 * Derived rather than listed so a network can never appear in the catalog or
 * the ERC-8004 document while the payment wall cannot actually take money on
 * it — the failure mode that left `["base"]` hardcoded and correct only by
 * coincidence.
 */
export function supportedNetworks(env: NetworkEnv): string[] {
  const svm = svmNetwork(env);
  return svm ? [evmNetwork(env), svm] : [evmNetwork(env)];
}

// Crawl/map execution bounds. Workers on paid plans allow 10k subrequests per
// invocation and bill CPU (not network wait), so these are set for predictable
// latency rather than platform headroom.
export const CRAWL_LIMITS = {
  concurrency: 5,       // simultaneous page fetches per batch
  maxQueued: 500,       // cap on the discovered-URL frontier
  // Sitemap documents fetched per /map call. Real sites nest: both
  // developers.cloudflare.com and x402.org serve a sitemap *index* whose
  // children must be fetched, so this needs headroom above the index itself.
  maxSitemapDocs: 10,
} as const;

// Viewport bounds for screenshots
export const VIEWPORT_BOUNDS = {
  width: { min: 320, max: 3840, default: 1280 },
  height: { min: 240, max: 2160, default: 720 },
} as const;

// Timeout configuration
export const TIMEOUT_CONFIG = {
  default: 10000, // 10 seconds
  min: 5000, // 5 seconds
  max: 30000, // 30 seconds
} as const;

// ============================================
// x402 Catalog Identity
// ============================================
//
// `serviceName`, `tags` and `iconUrl` are fields of the x402 `RouteConfig`
// (@x402/core) — NOT of the bazaar extension. Putting them inside the object
// returned by `declareDiscoveryExtension()` silently does nothing: the
// extension preserves unknown keys, so the value survives into the 402 header
// and is echoed back by CDP's `/validate` under `bazaarExtension.serviceName`,
// which looks like confirmation but never reaches the catalog record
// (x402-foundation/x402#2112). Facilitator catalogs write the record at
// **settle** time, so a route only picks these up on its next settled payment.
export const SERVICE_NAME = "WebLens";

/** Catalog icon. Served by `faviconPngHandler`; origin is taken from the request. */
export const SERVICE_ICON_PATH = "/favicon.png";

// Tags are matched by longest path prefix, so "/search/news" beats "/search".
// Keep the specific entries above the general ones.
const TAG_PREFIXES: readonly (readonly [string, readonly string[]])[] = [
  ["/social/youtube/transcript", ["video", "transcript", "youtube"]],
  ["/research/deep", ["research", "ai", "multi-step"]],
  ["/intel/site-audit", ["intelligence", "seo", "audit"]],
  ["/intel/competitive", ["intelligence", "competitive", "ai"]],
  ["/intel/company", ["intelligence", "company", "ai"]],
  ["/intel/market", ["intelligence", "market", "ai"]],
  ["/intel/project", ["intelligence", "diligence", "ai"]],
  ["/extract/smart", ["extraction", "ai", "structured-data"]],
  ["/fetch", ["fetch", "scraping", "markdown"]],
  ["/search", ["search", "serp"]],
  ["/extract", ["extraction", "ai", "structured-data"]],
  ["/batch/fetch", ["fetch", "scraping", "batch"]],
  ["/research", ["research", "ai"]],
  ["/screenshot", ["screenshot", "rendering"]],
  ["/monitor", ["monitoring", "change-detection"]],
  ["/memory", ["storage", "agent-memory"]],
  ["/credits", ["billing", "credits"]],
  ["/contents", ["fetch", "scraping", "batch"]],
  ["/answer", ["search", "ai", "question-answering"]],
  ["/compare", ["comparison", "ai"]],
  ["/crawl", ["crawling", "scraping"]],
  ["/discussions", ["search", "social"]],
  ["/domain", ["domain", "whois"]],
  ["/package", ["package", "registry"]],
  ["/tech", ["technology", "fingerprinting"]],
  ["/map", ["crawling", "sitemap"]],
  ["/pdf", ["pdf", "documents"]],
];

/**
 * Catalog tags for a paid path. Returns the longest-prefix match so agents
 * searching a facilitator catalog by intent can find the endpoint.
 */
export function tagsForPath(path: string): string[] {
  let best: readonly string[] = [];
  let bestLen = -1;
  for (const [prefix, tags] of TAG_PREFIXES) {
    if ((path === prefix || path.startsWith(`${prefix}/`)) && prefix.length > bestLen) {
      best = tags;
      bestLen = prefix.length;
    }
  }
  return [...best];
}
