/**
 * Free previews — the evaluation-friction fix.
 *
 * Agents discover the catalogue, cannot judge whether an endpoint is worth
 * its price, and leave without paying. A preview lets them see the exact
 * price for their own request body plus a real sample of the response shape
 * before committing.
 *
 * COST RULE: a preview must never cost us money. Endpoints backed by a paid
 * upstream (SerpAPI, Anthropic) are NEVER executed for free — they return a
 * recorded sample. Only endpoints whose marginal cost is a plain fetch may
 * run live, truncated, and rate-limited.
 */

import { PAID_ENDPOINTS, PRICING } from "../config";

/**
 * Endpoints whose marginal cost is a native fetch (no paid upstream API), so
 * a truncated live preview is free to serve.
 */
export const LIVE_PREVIEW_ENDPOINTS: readonly string[] = [
    "/fetch/basic",
    "/contents",
    "/map",
    "/domain",
];

/** Characters of live preview content returned per request. */
export const LIVE_PREVIEW_CHARS = 500;

interface PreviewEntry {
    /** One line on what the caller gets for the money. */
    summary: string;
    /** Recorded example of the real response shape. */
    sample: Record<string, unknown>;
}

/**
 * Recorded response samples, one per paid endpoint. These illustrate SHAPE
 * and field names — a preview also returns the live price, and for
 * LIVE_PREVIEW_ENDPOINTS a real truncated result.
 *
 * A test asserts every entry of PAID_ENDPOINTS appears here, so adding a
 * paid endpoint without a preview fails the build rather than silently
 * shipping an un-evaluatable product.
 */
export const PREVIEW_SAMPLES: Record<string, PreviewEntry> = {
    "/domain": {
        summary: "Who owns a domain, how old it is, what runs on it, and whether it looks risky — one call.",
        sample: {
            domain: "stripe.com",
            registration: { found: true, registrar: "MarkMonitor Inc.", registeredAt: "1995-09-12T04:00:00Z", expiresAt: "2027-09-11T04:00:00Z", status: ["client transfer prohibited"] },
            dns: { A: ["198.137.150.111"], MX: ["10 aspmx.l.google.com."], NS: ["ns-1087.awsdns-07.org."] },
            email: { provider: "Google Workspace", hasSpf: true, hasDmarc: true, dmarcPolicy: "reject" },
            hosting: { dnsProvider: "AWS Route 53" },
            stack: ["Microsoft 365", "Salesforce"],
            signals: [],
            ageDays: 11282,
            expiresInDays: 405,
        },
    },
    "/fetch/basic": {
        summary: "Any webpage as clean markdown, no JavaScript rendering.",
        sample: { url: "https://example.com", title: "Example Domain", content: "# Example Domain\n\nThis domain is for use in illustrative examples...", tier: "basic", fetchedAt: "2026-07-31T12:00:00.000Z" },
    },
    "/fetch/pro": {
        summary: "Same, but rendered in headless Chromium first — for SPAs.",
        sample: { url: "https://app.example.com", title: "Dashboard", content: "# Dashboard\n\nContent rendered after JavaScript execution...", tier: "pro", fetchedAt: "2026-07-31T12:00:00.000Z" },
    },
    "/fetch/resilient": {
        summary: "Native fetch, falling back to headless Chromium when it fails.",
        sample: { url: "https://example.com", title: "Example", content: "# Example...", provider: { id: "weblens-native", name: "WebLens Native", attemptsUsed: 1 }, tier: "resilient" },
    },
    "/contents": {
        summary: "Bulk page text for 1-20 URLs, truncated to your character cap.",
        sample: { results: [{ url: "https://example.com", status: "success", title: "Example Domain", content: "# Example Domain...", truncated: false }], summary: { total: 1, successful: 1, failed: 0 } },
    },
    "/screenshot": {
        summary: "PNG screenshot of a page, base64-encoded.",
        sample: { url: "https://example.com", image: "iVBORw0KGgoAAAANSUhEUgAA...(base64 PNG)", dimensions: { width: 1280, height: 720 }, capturedAt: "2026-07-31T12:00:00.000Z" },
    },
    "/batch/fetch": {
        summary: "2-20 URLs fetched in parallel in one call.",
        sample: { results: [{ url: "https://example.com/1", status: "success", title: "Page 1", content: "Content..." }], summary: { total: 2, successful: 2, failed: 0 }, totalPrice: "$0.006" },
    },
    "/map": {
        summary: "Every URL on a site, from sitemaps and links — no page fetches.",
        sample: { url: "https://example.com", urls: ["https://example.com/about", "https://example.com/blog/post-1"], total: 2, source: "sitemap", sitemapsChecked: 1 },
    },
    "/crawl": {
        summary: "Whole-site crawl returning markdown per page, in one call.",
        sample: { url: "https://example.com", pages: [{ url: "https://example.com", depth: 0, status: "success", title: "Example", content: "# Example..." }], summary: { crawled: 2, successful: 2, failed: 0, discovered: 5, robotsRespected: true } },
    },
    "/search": {
        summary: "Ranked web results; set includeContent to get page markdown too.",
        sample: { query: "x402 payment protocol", results: [{ position: 1, title: "x402 Protocol", url: "https://x402.org", snippet: "HTTP-native micropayments..." }], searchedAt: "2026-07-31T12:00:00.000Z" },
    },
    "/search/news": {
        summary: "Google News articles with source, date, and thumbnail.",
        sample: { query: "artificial intelligence", results: [{ position: 1, title: "AI breakthrough announced", url: "https://news.example.com/ai", source: "Example News", date: "07/31/2026", isoDate: "2026-07-31T10:00:00Z" }] },
    },
    "/search/images": {
        summary: "Direct image URLs with dimensions and source pages.",
        sample: { query: "golden gate bridge", results: [{ position: 1, title: "Golden Gate Bridge", imageUrl: "https://images.example.com/ggb.jpg", sourcePage: "https://example.com/ggb", width: 1920, height: 1080 }] },
    },
    "/search/places": {
        summary: "Local businesses: address, rating, reviews, phone, coordinates.",
        sample: { query: "coffee shops", location: "Austin, Texas", results: [{ position: 1, name: "Example Coffee", address: "123 Main St, Austin, TX", rating: 4.7, reviews: 812, phone: "(512) 555-0100", website: "https://examplecoffee.com", coordinates: { latitude: 30.26, longitude: -97.74 } }] },
    },
    "/search/shopping": {
        summary: "Products with prices, sellers, and ratings.",
        sample: { query: "mechanical keyboard", results: [{ position: 1, title: "Mechanical Keyboard RGB", url: "https://shop.example.com/kb", price: "$89.99", extractedPrice: 89.99, source: "Example Store", rating: 4.5 }] },
    },
    "/search/scholar": {
        summary: "Academic papers with publication info and citation counts.",
        sample: { query: "transformer attention", results: [{ position: 1, title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762", publicationInfo: "A Vaswani, N Shazeer - NeurIPS, 2017", citedBy: 130000 }] },
    },
    "/search/autocomplete": {
        summary: "Query suggestions — keyword and intent research.",
        sample: { query: "how to deploy cloudf", suggestions: ["how to deploy cloudflare workers", "how to deploy cloudflare pages"] },
    },
    "/search/trends": {
        summary: "Interest-over-time timeline for a topic.",
        sample: { query: "cloudflare workers", timeline: [{ date: "Jul 20 - 26, 2026", values: [{ query: "cloudflare workers", value: 87 }] }] },
    },
    "/social/youtube/transcript": {
        summary: "Full video transcript with timestamps.",
        sample: { videoId: "dQw4w9WgXcQ", segments: [{ startMs: 0, startTime: "0:00", text: "We're no strangers to love" }], fullText: "We're no strangers to love..." },
    },
    "/extract": {
        summary: "Structured JSON pulled from a page against your schema.",
        sample: { url: "https://example.com/product", data: { name: "Product Name", price: 99.99, inStock: true }, extractedAt: "2026-07-31T12:00:00.000Z" },
    },
    "/extract/smart": {
        summary: "Same, described in plain English instead of a schema.",
        sample: { url: "https://example.com/contact", query: "find all email addresses", data: [{ value: "contact@example.com", context: "Contact page footer", confidence: 0.95 }], explanation: "Found 1 email address" },
    },
    "/pdf": {
        summary: "Text and metadata out of a PDF, page by page.",
        sample: { url: "https://example.com/doc.pdf", metadata: { title: "Sample Document", author: "Jane Doe", pageCount: 10 }, pages: [{ pageNumber: 1, content: "Page 1 text..." }], fullText: "Page 1 text..." },
    },
    "/answer": {
        summary: "A direct answer with inline [n] citations to real sources.",
        sample: { query: "What is the x402 payment protocol?", answer: "x402 is an open payment protocol built on HTTP 402 [1]. It settles USDC payments on Base [2].", citations: [{ index: 1, url: "https://x402.org", title: "x402 Protocol" }], confidence: 0.92 },
    },
    "/research": {
        summary: "Search + fetch + AI summary with the sources listed.",
        sample: { query: "x402 payment protocol benefits", sources: [{ url: "https://x402.org", title: "x402 Protocol", snippet: "HTTP-native micropayments..." }], summary: "x402 is an open payment protocol...", keyFindings: ["Zero fees", "Instant settlement"] },
    },
    "/research/deep": {
        summary: "Multi-step research: sub-questions, cited answer, and gaps.",
        sample: { query: "How are AI agents using micropayments?", depth: "standard", subQuestions: ["x402 adoption 2026", "agent payment volume"], answer: "Agent micropayments consolidated around x402 [1]...", keyFindings: ["Median per-call price near $0.01"], citations: [{ index: 1, url: "https://x402.org", title: "x402 Protocol", subQuestion: "x402 adoption 2026" }], gaps: ["Sources did not cover settlement failure rates"] },
    },
    "/compare": {
        summary: "2-3 pages compared, with similarities and differences.",
        sample: { sources: [{ url: "https://product-a.com", title: "Product A" }], comparison: { similarities: ["Both offer feature X"], differences: ["Product A has Z"], summary: "Product A focuses on..." } },
    },
    "/intel/company": {
        summary: "Company deep dive: funding, people, positioning.",
        sample: { name: "Coinbase", domain: "coinbase.com", funding: "Public (COIN)", summary: "Coinbase is a secure online platform for buying, selling, and storing crypto." },
    },
    "/intel/market": {
        summary: "Market report: size, growth, trends, players, actions.",
        sample: { topic: "AI Agents", executiveSummary: "The AI agents market is rapidly expanding...", marketSize: "$10B (2026)", growthRate: "45% CAGR", keyTrends: ["autonomous tooling"], keyPlayers: ["Anthropic"], recommendations: ["Invest in agent infrastructure"] },
    },
    "/intel/competitive": {
        summary: "Competitor set with feature matrix, pricing, and SWOT.",
        sample: { company: "Example Corp", competitors: ["Acme Inc", "Globex"], featureMatrix: { "Example Corp": ["Feature A"] }, pricing: { "Example Corp": "$99/mo" }, swot: { strengths: ["Brand"], weaknesses: ["Pricing"], opportunities: ["AI integration"], threats: ["Open source"] } },
    },
    "/intel/site-audit": {
        summary: "SEO, performance, security and accessibility scores plus fixes.",
        sample: { url: "https://example.com", scores: { seo: 87, performance: 92, security: 95, accessibility: 88 }, issues: [{ severity: "high", category: "seo", message: "Missing meta description" }], recommendations: ["Add unique meta descriptions"] },
    },
    "/monitor/create": {
        summary: "Watch a URL and get a webhook when it changes.",
        sample: { monitorId: "mon_abc123", url: "https://example.com/status", webhookUrl: "https://your-app.com/webhook", checkInterval: 1, status: "active" },
    },
    "/memory/set": {
        summary: "Persist a key/value for your agent across calls.",
        sample: { key: "user_prefs", stored: true, ttlHours: 168, expiresAt: "2026-08-07T12:00:00.000Z" },
    },
    "/credits/buy": {
        summary: "Prepay credits; deposit bonuses at $10 / $50 / $100.",
        sample: { wallet: "0x1234...abcd", deposited: 10, bonus: 2, balance: 12, tier: "standard" },
    },
};

/** Human-readable price description for an endpoint, straight from PRICING. */
export function describePrice(endpoint: string): string {
    switch (endpoint) {
        case "/contents":
            return `${PRICING.contents.perUrl} per URL`;
        case "/batch/fetch":
            return `${PRICING.batchFetch.perUrl} per URL`;
        case "/crawl":
            return `${PRICING.crawl.perPage} per requested page`;
        case "/research/deep":
            return `${PRICING.deepResearch.standard} standard / ${PRICING.deepResearch.deep} deep`;
        case "/credits/buy":
            return "$2 - $1000 (you choose)";
        default:
            return PREVIEW_PRICE_HINT[endpoint] ?? "see the 402 challenge";
    }
}

/** Flat prices, resolved from PRICING so they cannot drift. */
const PREVIEW_PRICE_HINT: Record<string, string> = {
    "/fetch/basic": PRICING.fetch.basic,
    "/fetch/pro": `${PRICING.fetch.pro} (up to 3x on bot-protected domains)`,
    "/fetch/resilient": PRICING.fetch.resilient,
    "/screenshot": PRICING.screenshot,
    "/map": PRICING.map,
    "/domain": PRICING.domain,
    "/search": `${PRICING.search} (+${PRICING.contents.perUrl}/result with includeContent)`,
    "/search/news": PRICING.searchVerticals.news,
    "/search/images": PRICING.searchVerticals.images,
    "/search/places": PRICING.searchVerticals.places,
    "/search/shopping": PRICING.searchVerticals.shopping,
    "/search/scholar": PRICING.searchVerticals.scholar,
    "/search/autocomplete": PRICING.searchVerticals.autocomplete,
    "/search/trends": PRICING.searchVerticals.trends,
    "/social/youtube/transcript": PRICING.youtubeTranscript,
    "/extract": `${PRICING.extract} (up to 3x on bot-protected domains)`,
    "/extract/smart": PRICING.smartExtract,
    "/pdf": PRICING.pdf,
    "/answer": PRICING.answer,
    "/research": PRICING.research,
    "/compare": PRICING.compare,
    "/intel/company": PRICING.intel.company,
    "/intel/market": PRICING.intel.market,
    "/intel/competitive": PRICING.intel.competitive,
    "/intel/site-audit": PRICING.intel.siteAudit,
    "/monitor/create": `${PRICING.monitor.setup} + ${PRICING.monitor.perCheck}/check`,
    "/memory/set": PRICING.memory.write,
};

export function isPaidEndpoint(endpoint: string): boolean {
    return PAID_ENDPOINTS.includes(endpoint);
}
