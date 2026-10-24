/**
 * WebLens Configuration
 * Pricing, facilitators, and cache settings
 */

// A named import, so the bundler keeps only this field of package.json.
import { version } from "../package.json";

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
 * Serper (Google search and its verticals, SEARCH_PROVIDERS.serperCreditUsd
 * per credit), SerpAPI (Trends and YouTube transcripts,
 * SEARCH_PROVIDERS.serpApiCallUsd per call) and Anthropic.
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
  },
  // Search and its verticals run on Serper: 1-2 credits a call (shopping 2,
  // images 2 above 10 results), so $0.001-0.002 upstream. The $0.015 prices
  // were set when every search cost $0.009-0.015 on SerpAPI; repricing is a
  // separate decision.
  search: "$0.015",
  searchVerticals: {
    news: "$0.015",
    images: "$0.015",
    places: "$0.045",   // market anchor: StableEnrich sells Maps-backed places at $0.045
    shopping: "$0.015",
    scholar: "$0.015",
    autocomplete: "$0.015",
    // Market anchor: x402atlas sells the same interest-over-time series at
    // $0.05, the most-paid web-data endpoint on the CDP Bazaar (1,138
    // calls in the 30 days to 2026-10-13). One SerpAPI call upstream.
    trends: "$0.04",
  },
  // Per-result page-content addon for search (includeContent) and the
  // standalone /contents endpoint. Native fetch has ~zero marginal cost.
  contents: {
    perUrl: "$0.0015",
    minUrls: 1,
    maxUrls: 20,
  },
  youtubeTranscript: "$0.03", // 1 SerpAPI call upstream; StableSocial sells transcripts at $0.06
  answer: "$0.05", // ~$0.013 worst-case upstream (1 Serper search + capped Haiku tokens)
  extract: "$0.03",
  cacheDiscount: 0.7, // 70% off for cached responses
  // Smallest x402 payment WebLens takes. Every x402 sale pays the facilitator
  // a settle fee: PayAI charges gas x 1.30 (Base EIP-3009 = $0.00231, Solana
  // $0.00152) once its free allowance is spent, CDP $0.001 after 1,000 settles
  // a month. A cheaper payment loses money, so an x402 call costs
  // max(its list price after any cache discount, this), with headroom for
  // Base gas swings. Credit debits settle nothing and pay the list price.
  x402Minimum: "$0.004",

  // Batch fetch pricing
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

  // Company profile from a domain: a handful of free page/DNS/job-board
  // fetches plus one capped AI_MODEL pass (~$0.002). Priced against the
  // account-gated incumbents: PredictLeads $0.01-0.04 a request, Diffbot
  // ~$0.025 an entity, Wappalyzer ~$0.05 a lookup for the tech stack alone.
  company: "$0.05",

  // Bounded whole-site crawl. Priced per requested page (the page budget the
  // caller reserves), consistent with batch fetch. Native fetch + markdown,
  // so marginal cost is CPU only.
  crawl: {
    perPage: "$0.0015",
    minPages: 1,
    maxPages: 25,
    defaultPages: 10,
  },

  // Deep research, priced per depth tier. The tier bounds are the cost
  // model: see DEEP_RESEARCH_TIERS below before changing either.
  deepResearch: {
    quick: "$0.08",
    standard: "$0.20",
    deep: "$0.35",
  },

  // PDF extraction — native fetch + parse, no AI call (see tools/pdf.ts)
  pdf: "$0.004",

  // Intelligence endpoints
  intel: {
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
} as const;

/** Result pages /search fetches as markdown when `includeContent` is set; each is priced at PRICING.contents.perUrl. */
export const SEARCH_CONTENT_RESULTS = { min: 1, max: 10, default: 5 } as const;

/**
 * Prepaid packs a card buyer can choose, at face value: $10 buys $10 of calls.
 * No pack bonus (decided 2026-10-20, when a search cost $0.009-0.015 on SerpAPI,
 * so +40% would have sold a $0.015 search at $0.0107, below cost). Ten
 * dollars is the floor because card fees are partly fixed (about EUR 0.25 a
 * payment), which takes 10-12% of a $5 pack.
 */
export const CREDIT_PACKS = ["10", "50", "100"] as const;
export type CreditPack = (typeof CREDIT_PACKS)[number];

/** A pack's price, e.g. "$10". */
export function packPrice(pack: CreditPack): string {
  return `$${pack}`;
}

/**
 * Stripe Checkout with Managed Payments: Link is the merchant of record and
 * handles VAT, sales tax, invoices and disputes. Verified 2026-10-20 against
 * docs.stripe.com/payments/managed-payments: it needs API version
 * 2025-03-31.basil or later, and every product needs an eligible tax code.
 */
export const STRIPE = {
  apiBase: "https://api.stripe.com/v1",
  /** Pinned, so a change of Stripe's default version cannot alter responses (latest stable on 2026-10-20). */
  apiVersion: "2026-09-30.endive",
  /** Website Information Services - Business Use, eligible for Managed Payments. */
  taxCode: "txcd_10701400",
  productName: "WebLens API credits",
  timeoutMs: 15_000,
  /** Stripe's default webhook signature tolerance. */
  webhookToleranceSeconds: 300,
} as const;

/**
 * API keys: `<API_KEY_PREFIX><accountId>_<secret>`. The prefix is set per
 * environment (wrangler.toml), the account id names the account's Durable
 * Object, and the secret is 256 random bits in base64url, of which the account
 * stores only a hash.
 */
export const API_KEY_PATTERN = /^(wl_(?:live|test)_)([0-9a-f]{32})_([A-Za-z0-9_-]{43})$/u;

/**
 * The Claude model every AI step uses: extraction, answers, research planning
 * and synthesis. Claude Haiku 5.5 is Anthropic's model for high-volume
 * extraction and routing: $0.10 / $0.50 per MTok for prompts up to 100k tokens
 * (5x above that), and its tokenizer counts ~30% more tokens than Haiku 4.5.
 * Verified active on 2026-10-13, retirement not before 2027-10-07
 * (platform.claude.com/docs/en/about-claude/model-deprecations). The previous
 * /extract model, claude-sonnet-4-20250514, was retired on 2026-06-15.
 */
export const AI_MODEL = "claude-haiku-5-5";

/**
 * Deep research depth tiers. The bounds ARE the cost model: each sub-question
 * costs one search, and sources are capped and truncated before a capped
 * Haiku 5.5 synthesis (AI_MODEL; under $0.005 even for the deep tier's ~20k
 * input tokens). Each search is one Serper credit (5 results), so the AI
 * dominates the worst case:
 *   quick:    1 search  + AI = ~$0.006 -> $0.08, no planning call
 *   standard: 3 searches + AI = ~$0.008 -> $0.20
 *   deep:     5 searches + AI = ~$0.010 -> $0.35
 * Changing a tier's bounds changes its cost floor: reprice PRICING.deepResearch
 * with it (tests/unit/deep-research.test.ts asserts price > worst-case cost).
 */
export const DEEP_RESEARCH_DEPTHS = ["quick", "standard", "deep"] as const;
export type DeepResearchDepth = (typeof DEEP_RESEARCH_DEPTHS)[number];
export const DEEP_RESEARCH_DEFAULT_DEPTH: DeepResearchDepth = "standard";

export interface DeepResearchTier {
  /** Sub-questions researched, one search each. 1 = the question as asked, no planning call. */
  subQuestions: number;
  /** Maximum sources fetched and passed to synthesis. */
  maxSources: number;
  /** Per-source character cap fed to the model. */
  charsPerSource: number;
}

export const DEEP_RESEARCH_TIERS: Record<DeepResearchDepth, DeepResearchTier> = {
  quick: { subQuestions: 1, maxSources: 5, charsPerSource: 5000 },
  standard: { subQuestions: 3, maxSources: 8, charsPerSource: 5000 },
  deep: { subQuestions: 5, maxSources: 12, charsPerSource: 5000 },
};

/** Every tier's bounds and price in one line, for each surface that documents them. */
export function describeDeepResearchTiers(): string {
  const tiers = DEEP_RESEARCH_DEPTHS.map((depth) => {
    const { subQuestions, maxSources } = DEEP_RESEARCH_TIERS[depth];
    const searches = subQuestions === 1 ? "1 search" : `${String(subQuestions)} sub-questions`;
    return `${depth} = ${searches} / ${String(maxSources)} sources (${PRICING.deepResearch[depth]})`;
  });
  return `${tiers.join("; ")}. Default: ${DEEP_RESEARCH_DEFAULT_DEPTH}.`;
}

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
} as const;

// Default facilitator base URLs; `PAYAI_FACILITATOR_URL` / `FACILITATOR_URL`
// override them. CDP's URL comes from `@coinbase/x402`'s facilitator config.
//
// Facilitator selection is NOT configured here — facilitatorPlans() in
// src/middleware/payment.ts reads the order from FACILITATORS_EVM /
// FACILITATORS_SVM and each facilitator's credentials and URL overrides
// (CDP_API_KEY_*, PAYAI_API_KEY_*, FACILITATOR_URL, PAYAI_FACILITATOR_URL).
export const FACILITATOR_URLS = {
  payai: "https://facilitator.payai.network",
  testnet: "https://x402.org/facilitator",
} as const;

// CAIP-2 chain identifiers for every network WebLens can be paid on.
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

/** The env fields that decide whether prepaid API keys are sold by card. */
export interface CardPaymentsEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
}

/**
 * Card sales need both Stripe secrets: the key opens Checkout Sessions and the
 * webhook secret confirms payments the buyer never returns from
 * (docs.stripe.com/checkout/fulfillment: webhooks are required). Every surface
 * that mentions API keys or /billing asks this, so nothing advertises a
 * purchase that would answer 503.
 */
export function cardPaymentsEnabled(env: CardPaymentsEnv): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}

/** The env fields the public documents read: networks and card sales. */
export type SurfaceEnv = NetworkEnv & CardPaymentsEnv;

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

const NETWORK_DISPLAY_NAMES = new Map<string, string>([
  [NETWORKS.baseMainnet, "Base"],
  [NETWORKS.baseSepolia, "Base Sepolia"],
  [NETWORKS.solanaMainnet, "Solana"],
  [NETWORKS.solanaDevnet, "Solana devnet"],
]);

/**
 * The live networks as prose for docs and descriptions — "Base or Solana".
 * Derived from {@link supportedNetworks} so prose cannot drift from the wall.
 */
export function supportedNetworkNames(env: NetworkEnv): string {
  const names = supportedNetworks(env).map((id) => NETWORK_DISPLAY_NAMES.get(id) ?? id);
  const last = names.pop() ?? "";
  return names.length > 0 ? `${names.join(", ")} or ${last}` : last;
}

/**
 * Analytics Engine dataset names behind the PAYMENT_EVENTS binding, per
 * wrangler environment. wrangler.toml must declare exactly these
 * (tests/unit/payment-events-dataset.test.ts); scripts/payment-funnel.ts reads
 * them from here.
 */
export const PAYMENT_EVENTS_DATASETS = {
  production: "weblens_payment_events",
  testnet: "weblens_payment_events_testnet",
} as const;

/**
 * Upstream APIs that bill us per call. Free routes must never reach these
 * (tests/workers/free-routes-cost.test.ts derives its forbidden hosts from
 * this map), and every paid route that uses one must clear its cost floor.
 */
/**
 * Marketplaces that bill their own users and call WebLens on their behalf, so
 * their calls skip x402 and the prepaid ledger (middleware/partner.ts). Each
 * authenticates with a shared secret in its own header; the secret is a Worker
 * secret named by `secret`, and a partner without it set cannot call.
 */
export const PARTNERS = {
  apify: { header: "X-WebLens-Partner-Key", secret: "APIFY_PARTNER_SECRET" },
} as const;
export type PartnerName = keyof typeof PARTNERS;

export const PAID_UPSTREAMS = {
  anthropicMessages: "https://api.anthropic.com/v1/messages",
  serper: "https://google.serper.dev",
  serpApiSearch: "https://serpapi.com/search.json",
} as const;

/**
 * Search providers (services/search.ts). Serper sells credits in one-time packs
 * valid for 6 months; its $50 Starter pack is 50k credits, $0.001 each
 * (serper.dev, 2026-10-24), and a call costs 1 credit (shopping 2, images 2
 * above 10 results). SerpAPI's per-search price ranges $0.009-0.015 by plan.
 */
export const SEARCH_PROVIDERS = {
  timeoutMs: 15_000,
  serperCreditUsd: 0.001,
  /** Most credits one search WebLens sells can use. */
  serperMaxCreditsPerCall: 2,
  serpApiCallUsd: 0.015,
} as const;

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

// Upper bound on a fetched page body. The body is streamed and cut off here, so
// a multi-megabyte download (e.g. a 33MB gzip served as text/plain) cannot pin
// an isolate's memory or burn CPU in the HTML-to-markdown pass. Real HTML pages
// sit well below this; long Wikipedia articles are ~1-2MB.
export const FETCH_LIMITS = {
  maxDocumentBytes: 5 * 1024 * 1024,
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

/** Response-cache TTL bounds and default, in seconds (services/cache.ts clamps to them). */
export const CACHE_TTL_SECONDS = { min: 60, max: 86_400, default: 3_600 } as const;

/** How WebLens identifies itself when it fetches a site on a caller's behalf (robots.txt rules match it). */
export const BOT_USER_AGENT = "Mozilla/5.0 (compatible; WebLensBot/1.0; +https://api.weblens.dev)";

/**
 * Bounds for /company. They are its cost model: pages fetched are free
 * subrequests, and the one AI_MODEL pass reads at most `pagesForAI` pages of
 * `charsPerPage` each (~10k tokens, ~$0.001) and writes at most `maxTokens`.
 */
/**
 * The 2022 NAICS sectors (census.gov 2022 NAICS Manual, Part I), the industry
 * /company classifies a company into from its own site.
 */
export const NAICS_SECTORS = {
  "11": "Agriculture, Forestry, Fishing and Hunting",
  "21": "Mining, Quarrying, and Oil and Gas Extraction",
  "22": "Utilities",
  "23": "Construction",
  "31-33": "Manufacturing",
  "42": "Wholesale Trade",
  "44-45": "Retail Trade",
  "48-49": "Transportation and Warehousing",
  "51": "Information",
  "52": "Finance and Insurance",
  "53": "Real Estate and Rental and Leasing",
  "54": "Professional, Scientific, and Technical Services",
  "55": "Management of Companies and Enterprises",
  "56": "Administrative and Support and Waste Management and Remediation Services",
  "61": "Educational Services",
  "62": "Health Care and Social Assistance",
  "71": "Arts, Entertainment, and Recreation",
  "72": "Accommodation and Food Services",
  "81": "Other Services (except Public Administration)",
  "92": "Public Administration",
} as const;
export type NaicsSector = keyof typeof NAICS_SECTORS;

/** Employee-count bands /company reports, as commonly used for firmographics; the last is open-ended. */
export const EMPLOYEE_BANDS = [
  { label: "1-10", max: 10 },
  { label: "11-50", max: 50 },
  { label: "51-200", max: 200 },
  { label: "201-500", max: 500 },
  { label: "501-1000", max: 1_000 },
  { label: "1001-5000", max: 5_000 },
  { label: "5001-10000", max: 10_000 },
  { label: "10001+", max: Number.POSITIVE_INFINITY },
] as const;

export const COMPANY_PROFILE = {
  /** Per-request fetch timeout for the site's own pages and the job board. */
  timeoutMs: 12_000,
  /** Largest HTML document read from a page the model reads. */
  maxHtmlBytes: 400_000,
  /**
   * Largest careers page read, only to find the job board it links to. Sites
   * embed their board data deep in the page: Vercel's careers page is 1.4 MB
   * with its first Greenhouse link at 1.32 MB.
   */
  maxCareersHtmlBytes: 4 * 1024 * 1024,
  /** Tried when the homepage links no careers page: the conventional path. */
  careersPath: "/careers",
  /** Characters of each page's text the model reads. */
  charsPerPage: 6_000,
  /** Homepage, about and pricing: the pages that say what the company sells. */
  pagesForAI: 3,
  maxTokens: 1_500,
  /** Open roles listed by title in `hiring.sample`. */
  sampleRoles: 10,
  /**
   * Largest job-board response read. Lever and Ashby return every posting with
   * its full description: Palantir's Lever board (312 roles) is 6.1 MB.
   */
  maxBoardBytes: 16 * 1024 * 1024,
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

/** The release, as package.json records it. */
export const SERVICE_VERSION = version;

/** Catalog icon. Served by `faviconPngHandler`; origin is taken from the request. */
export const SERVICE_ICON_PATH = "/favicon.png";

