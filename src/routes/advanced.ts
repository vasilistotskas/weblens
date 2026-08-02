import type { Context, Hono } from "hono";
import { PRICING } from "../config";
import { createCreditMiddleware } from "../middleware/credit-middleware";
import { createLazyPaymentMiddleware } from "../middleware/payment";
import { validateRequest } from "../middleware/validation";
import {
    BatchFetchRequestSchema,
    ResearchRequestSchema,
    PdfRequestSchema,
    CompareRequestSchema,
    MapRequestSchema,
    CrawlRequestSchema,
    DeepResearchRequestSchema,
    DomainRequestSchema,
    PackageRequestSchema,
    TechRequestSchema,
    DiscussionsRequestSchema
} from "../schemas";
import { getBatchFetchPrice, parsePrice } from "../services/pricing";

// Tool Handlers
import { batchFetchHandler } from "../tools/batch-fetch";
import { compareHandler } from "../tools/compare";
import { crawlHandler } from "../tools/crawl";
import { deepResearchHandler } from "../tools/deep-research";
import { discussionsHandler } from "../tools/discussions";
import { domainHandler } from "../tools/domain";
import { mapHandler } from "../tools/map";
import { packageHandler } from "../tools/package-intel";
import { pdfHandler } from "../tools/pdf";
import { researchHandler } from "../tools/research";
import { techHandler } from "../tools/tech";
import type { Env, Variables } from "../types";

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export function registerAdvancedRoutes(app: Hono<{ Bindings: Env; Variables: Variables }>) {

    // ============================================
    // /batch/fetch
    // ============================================
    //
    // Pricing is dynamic — N URLs × $0.003 per URL. validateRequest runs
    // before both credit and payment middleware, so by the time pricing is
    // calculated `validatedBody` is guaranteed to be a parsed BatchFetchRequest
    // with `urls` populated.
    const batchFetchPriceCalc = (
        c: { get: (k: "validatedBody") => unknown }
    ): string => {
        const body = c.get("validatedBody") as { urls?: unknown[] } | undefined;
        const n = Array.isArray(body?.urls) ? body.urls.length : PRICING.batchFetch.minUrls;
        return getBatchFetchPrice(n);
    };
    app.use(
        "/batch/fetch",
        validateRequest(BatchFetchRequestSchema),
        createCreditMiddleware(
            (c) => batchFetchPriceCalc(c),
            "Batch URL Fetching"
        ),
        createLazyPaymentMiddleware(
            "/batch/fetch",
            // Dynamic price — re-evaluated per request from the parsed body.
            (c) => Promise.resolve(batchFetchPriceCalc(c)),
            "Fetch multiple URLs in parallel with a single request. Efficient for bulk operations. Supports 2-20 URLs per request at $0.003/URL.",
            { urls: ["https://example.com/1", "https://example.com/2"], timeout: 10000, tier: "basic" },
            {
                properties: {
                    urls: { type: "array", description: "Array of URLs to fetch (2-20)" },
                    timeout: { type: "number", description: "Per-URL timeout in ms (default: 10000)" },
                    tier: { type: "string", description: "Fetch tier: basic or pro (default: basic)" },
                },
                required: ["urls"],
            },
            {
                results: [
                    { url: "https://example.com/1", status: "success", title: "Page 1", content: "Content 1..." },
                    { url: "https://example.com/2", status: "success", title: "Page 2", content: "Content 2..." },
                ],
                summary: { total: 2, successful: 2, failed: 0 },
                totalPrice: "$0.006",
                requestId: "req_batch123",
            },
            {
                properties: {
                    results: { type: "array", description: "Array of fetch results with url, status, content, title" },
                    summary: { type: "object", description: "Summary with total, successful, failed counts" },
                    totalPrice: { type: "string" },
                    requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/batch/fetch", batchFetchHandler);

    // ============================================
    // /research
    // ============================================
    app.use(
        "/research",
        validateRequest(ResearchRequestSchema),
        createCreditMiddleware(PRICING.research, "AI Research Assistant"),
        createLazyPaymentMiddleware(
            "/research",
            PRICING.research,
            "One-stop research assistant: searches the web, fetches top results, and generates an AI-powered summary with key findings.",
            { query: "x402 payment protocol benefits", resultCount: 5, includeRawContent: false },
            {
                properties: {
                    query: { type: "string", description: "Research topic or question" },
                    resultCount: { type: "number", description: "Number of sources to analyze, 1-10 (default: 5)", minimum: 1, maximum: 10 },
                    includeRawContent: { type: "boolean", description: "Include full fetched content in response" },
                },
                required: ["query"],
            },
            {
                query: "x402 payment protocol benefits",
                sources: [
                    { url: "https://x402.org", title: "x402 Protocol", snippet: "HTTP-native micropayments..." },
                ],
                summary: "x402 is an open payment protocol...",
                keyFindings: ["Zero fees", "Instant settlement"],
                researchedAt: "2026-01-26T12:00:00.000Z",
                requestId: "req_research456",
            },
            {
                properties: {
                    query: { type: "string" },
                    sources: { type: "array", description: "Array of sources with url, title, snippet" },
                    summary: { type: "string", description: "AI-generated research summary" },
                    keyFindings: { type: "array", description: "Bullet points of key findings" },
                    researchedAt: { type: "string" },
                    requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/research", researchHandler);

    // ============================================
    // /pdf
    // ============================================
    app.use(
        "/pdf",
        validateRequest(PdfRequestSchema),
        createCreditMiddleware(PRICING.pdf, "PDF Text Extraction"),
        createLazyPaymentMiddleware(
            "/pdf",
            PRICING.pdf,
            "Extract text and metadata from PDF documents. Supports page-specific extraction and returns structured content.",
            { url: "https://example.com/document.pdf", pages: [1, 2, 3] },
            {
                properties: {
                    url: { type: "string", description: "URL of the PDF document" },
                    pages: { type: "array", description: "Specific page numbers to extract (omit for all pages)" },
                },
                required: ["url"],
            },
            {
                url: "https://example.com/document.pdf",
                metadata: { title: "Sample Document", author: "John Doe", pageCount: 10 },
                pages: [
                    { pageNumber: 1, content: "Page 1 text content..." },
                ],
                fullText: "Page 1 text content...",
                extractedAt: "2026-01-26T12:00:00.000Z",
                requestId: "req_pdf123",
            },
            {
                properties: {
                    url: { type: "string" },
                    metadata: { type: "object", description: "PDF metadata" },
                    pages: { type: "array", description: "Array of pages with content" },
                    fullText: { type: "string", description: "All pages concatenated" },
                    extractedAt: { type: "string" },
                    requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/pdf", pdfHandler);

    // ============================================
    // /compare
    // ============================================
    app.use(
        "/compare",
        validateRequest(CompareRequestSchema),
        createCreditMiddleware(PRICING.compare, "Webpage Comparison"),
        createLazyPaymentMiddleware(
            "/compare",
            PRICING.compare,
            "Compare 2-3 webpages with AI-generated analysis. Identifies similarities, differences, and provides a comprehensive summary.",
            { urls: ["https://product-a.com", "https://product-b.com"], focus: "pricing and features" },
            {
                properties: {
                    urls: { type: "array", description: "Array of 2-3 URLs to compare" },
                    focus: { type: "string", description: "What aspect to focus the comparison on" },
                },
                required: ["urls"],
            },
            {
                sources: [
                    { url: "https://product-a.com", title: "Product A", content: "Features: X..." },
                    { url: "https://product-b.com", title: "Product B", content: "Features: Y..." },
                ],
                comparison: {
                    similarities: ["Both offer feature X"],
                    differences: ["Product A has Z"],
                    summary: "Product A focuses on...",
                },
                comparedAt: "2026-01-26T12:00:00.000Z",
                requestId: "req_compare456",
            },
            {
                properties: {
                    sources: { type: "array", description: "Array of sources with url, title, content" },
                    comparison: { type: "object", description: "Comparison with similarities, differences, summary" },
                    comparedAt: { type: "string" },
                    requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/compare", compareHandler);

    // ============================================
    // /map — site URL discovery
    // ============================================
    app.use(
        "/map",
        validateRequest(MapRequestSchema),
        createCreditMiddleware(PRICING.map, "Site Map"),
        createLazyPaymentMiddleware(
            "/map",
            PRICING.map,
            "Discover a site's URLs without fetching page content. Reads robots.txt sitemap directives, sitemap.xml and nested sitemap indexes, falling back to homepage link extraction.",
            { url: "https://example.com", limit: 1000 },
            {
                properties: {
                    url: { type: "string", description: "Site URL to map" },
                    limit: { type: "number", description: "Maximum URLs to return (default 1000, max 5000)", maximum: 5000 },
                    include: { type: "array", description: "Only URLs whose path+query contains one of these substrings" },
                    exclude: { type: "array", description: "Skip URLs whose path+query contains one of these substrings" },
                },
                required: ["url"],
            },
            {
                url: "https://example.com",
                urls: ["https://example.com/about", "https://example.com/blog/post-1"],
                total: 2,
                source: "sitemap",
                sitemapsChecked: 1,
                mappedAt: "2026-07-31T12:00:00.000Z",
                requestId: "req_map123",
            },
            {
                properties: {
                    url: { type: "string" },
                    urls: { type: "array", description: "Discovered URLs" },
                    total: { type: "number" },
                    source: { type: "string", description: "sitemap | links | none" },
                    sitemapsChecked: { type: "number" },
                    mappedAt: { type: "string" },
                    requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/map", mapHandler);

    // ============================================
    // /domain — registration + DNS intelligence
    // ============================================
    app.use(
        "/domain",
        validateRequest(DomainRequestSchema),
        createCreditMiddleware(PRICING.domain, "Domain Intelligence"),
        createLazyPaymentMiddleware(
            "/domain",
            PRICING.domain,
            "Domain intelligence in one call: RDAP registration (registrar, age, expiry, status), live DNS (A/AAAA/MX/NS/TXT), the mail and DNS providers behind them, the SaaS vendors the domain's TXT verification tokens reveal, SPF/DMARC posture, and risk signals like newly-registered or no-registrar-lock.",
            { domain: "stripe.com" },
            {
                properties: {
                    domain: { type: "string", description: "Domain to inspect, e.g. \"stripe.com\". A full URL is reduced to its hostname." },
                },
                required: ["domain"],
            },
            {
                domain: "stripe.com",
                registration: {
                    found: true,
                    registrar: "MarkMonitor Inc.",
                    registeredAt: "1995-09-12T04:00:00Z",
                    expiresAt: "2027-09-11T04:00:00Z",
                    status: ["client transfer prohibited"],
                    nameservers: ["ns-1087.awsdns-07.org"],
                },
                dns: { A: ["198.137.150.111"], MX: ["10 aspmx.l.google.com."], NS: ["ns-1087.awsdns-07.org."] },
                email: { provider: "Google Workspace", hasSpf: true, hasDmarc: true, dmarcPolicy: "reject" },
                hosting: { dnsProvider: "AWS Route 53" },
                stack: ["Microsoft 365", "Salesforce"],
                signals: [],
                ageDays: 11282,
                expiresInDays: 405,
                inspectedAt: "2026-08-02T12:00:00.000Z",
                requestId: "req_domain123",
            },
            {
                properties: {
                    domain: { type: "string" },
                    registration: { type: "object", description: "RDAP: registrar, registeredAt, expiresAt, updatedAt, status, nameservers" },
                    dns: { type: "object", description: "Live records keyed by type (A, AAAA, MX, NS, TXT)" },
                    email: { type: "object", description: "provider, hasSpf, hasDmarc, dmarcPolicy" },
                    hosting: { type: "object", description: "dnsProvider" },
                    stack: { type: "array", description: "SaaS vendors inferred from TXT domain-verification tokens" },
                    signals: { type: "array", description: "Risk flags: newly-registered, expiring-soon, no-registrar-lock, no-spf, no-dmarc, dmarc-monitor-only, no-mx" },
                    ageDays: { type: "number" },
                    expiresInDays: { type: "number" },
                    inspectedAt: { type: "string" },
                    requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/domain", domainHandler);

    // ============================================
    // /package — npm + PyPI package intelligence
    // ============================================
    app.use(
        "/package",
        validateRequest(PackageRequestSchema),
        createCreditMiddleware(PRICING.package, "Package Intelligence"),
        createLazyPaymentMiddleware(
            "/package",
            PRICING.package,
            "Should you depend on this package? Version, license, deprecation (with the maintainer's reason), weekly and monthly downloads, last release date, maintainer count, npm quality/popularity/maintenance scores, and health signals — npm or PyPI, one call.",
            { name: "express", registry: "npm" },
            {
                properties: {
                    name: { type: "string", description: "Package name, e.g. \"express\" or \"@scope/pkg\"" },
                    registry: { type: "string", enum: ["npm", "pypi"], description: "Registry to look in (default npm)" },
                },
                required: ["name"],
            },
            {
                name: "express", registry: "npm", found: true, version: "5.2.1",
                description: "Fast, unopinionated, minimalist web framework",
                license: "MIT", repository: "https://github.com/expressjs/express",
                deprecated: false,
                downloads: { lastWeek: 127864826, lastMonth: 548000000 },
                maintenance: { lastPublishedAt: "2025-12-01T00:00:00.000Z", daysSinceRelease: 244, maintainers: 5, scores: { quality: 1, popularity: 1, maintenance: 1 } },
                dependencies: 28,
                signals: [],
                checkedAt: "2026-08-02T12:00:00.000Z",
                requestId: "req_pkg123",
            },
            {
                properties: {
                    name: { type: "string" }, registry: { type: "string" }, found: { type: "boolean" },
                    version: { type: "string" }, license: { type: "string" }, repository: { type: "string" },
                    deprecated: { type: "boolean" }, deprecationReason: { type: "string" },
                    downloads: { type: "object", description: "lastWeek, lastMonth (npm only)" },
                    maintenance: { type: "object", description: "lastPublishedAt, daysSinceRelease, maintainers, scores" },
                    dependencies: { type: "number" }, requiresPython: { type: "string" },
                    signals: { type: "array", description: "deprecated, no-recent-release, no-license, single-maintainer, no-public-repository" },
                    checkedAt: { type: "string" }, requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/package", packageHandler);

    // ============================================
    // /tech — website technology detection
    // ============================================
    app.use(
        "/tech",
        validateRequest(TechRequestSchema),
        createCreditMiddleware(PRICING.tech, "Tech Detection"),
        createLazyPaymentMiddleware(
            "/tech",
            PRICING.tech,
            "What a site is built and run on, from a single fetch: frameworks, CMS, ecommerce platform, CDN, analytics, payments, support widgets and web server — each with the header or HTML marker that proves it.",
            { url: "https://example.com" },
            {
                properties: { url: { type: "string", description: "Site URL to fingerprint" } },
                required: ["url"],
            },
            {
                url: "https://vercel.com", finalUrl: "https://vercel.com/", status: 200,
                server: "Vercel", poweredBy: "Next.js, Payload",
                technologies: [
                    { name: "Next.js", category: "framework", evidence: "header x-powered-by: Next.js, Payload" },
                    { name: "Vercel", category: "hosting", evidence: "header x-vercel-id: ..." },
                ],
                categories: { framework: ["Next.js"], hosting: ["Vercel"] },
                detectedAt: "2026-08-02T12:00:00.000Z",
                requestId: "req_tech123",
            },
            {
                properties: {
                    url: { type: "string" }, finalUrl: { type: "string" }, status: { type: "number" },
                    server: { type: "string" }, poweredBy: { type: "string" }, generator: { type: "string" },
                    technologies: { type: "array", description: "Each: name, category, evidence" },
                    categories: { type: "object", description: "Technology names grouped by category" },
                    detectedAt: { type: "string" }, requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/tech", techHandler);

    // ============================================
    // /discussions — Hacker News
    // ============================================
    app.use(
        "/discussions",
        validateRequest(DiscussionsRequestSchema),
        createCreditMiddleware(PRICING.discussions, "Discussions"),
        createLazyPaymentMiddleware(
            "/discussions",
            PRICING.discussions,
            "What Hacker News said about a topic: matching stories with points, comment counts and links to the threads, plus aggregates — total matches, points and comments returned, the domains most often submitted, and the first/last time it was discussed.",
            { query: "cloudflare workers", limit: 10 },
            {
                properties: {
                    query: { type: "string", description: "What to search Hacker News for" },
                    limit: { type: "number", description: "Stories to return (1-50, default 10)", maximum: 50 },
                    sort: { type: "string", enum: ["relevance", "recent"], description: "Ranking (default relevance)" },
                },
                required: ["query"],
            },
            {
                query: "cloudflare workers", source: "hackernews", sort: "relevance",
                stories: [{ title: "Workerd: Open-source Cloudflare Workers runtime", url: "https://github.com/cloudflare/workerd", points: 689, comments: 133, author: "jgrahamc", postedAt: "2022-09-27T14:00:00.000Z", discussionUrl: "https://news.ycombinator.com/item?id=32979198" }],
                summary: { totalMatches: 1259, returned: 10, pointsReturned: 3421, commentsReturned: 2870, topDomains: [{ domain: "github.com", count: 3 }], firstSeen: "2018-03-12T00:00:00.000Z", lastSeen: "2026-07-30T00:00:00.000Z" },
                discussedAt: "2026-08-02T12:00:00.000Z",
                requestId: "req_disc123",
            },
            {
                properties: {
                    query: { type: "string" }, source: { type: "string" }, sort: { type: "string" },
                    stories: { type: "array", description: "Each: title, url, points, comments, author, postedAt, discussionUrl" },
                    summary: { type: "object", description: "totalMatches, returned, pointsReturned, commentsReturned, topDomains, firstSeen, lastSeen" },
                    discussedAt: { type: "string" }, requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/discussions", discussionsHandler);

    // ============================================
    // /crawl — bounded whole-site crawl
    // ============================================
    // Priced on the requested page budget. ONE resolver feeds both the credit
    // debit and the x402 challenge so they can never diverge.
    const crawlPrice = (c: AppContext): string => {
        const body = c.get("validatedBody") as { limit?: number } | undefined;
        const pages = typeof body?.limit === "number" ? body.limit : 10;
        return `$${(pages * parsePrice(PRICING.crawl.perPage)).toFixed(4)}`;
    };
    app.use(
        "/crawl",
        validateRequest(CrawlRequestSchema),
        createCreditMiddleware((c) => crawlPrice(c as AppContext), "Site Crawl"),
        createLazyPaymentMiddleware(
            "/crawl",
            (c) => Promise.resolve(crawlPrice(c)),
            `Crawl a site and get clean markdown for every page, in one call. Same-host BFS with depth and page-budget limits, robots.txt honoured by default. ${PRICING.crawl.perPage} per requested page (${String(PRICING.crawl.minPages)}-${String(PRICING.crawl.maxPages)}).`,
            { url: "https://example.com", limit: 10, maxDepth: 2 },
            {
                properties: {
                    url: { type: "string", description: "Start URL" },
                    limit: { type: "number", description: `Page budget, ${String(PRICING.crawl.minPages)}-${String(PRICING.crawl.maxPages)} (default 10)`, maximum: PRICING.crawl.maxPages },
                    maxDepth: { type: "number", description: "Link depth from the start URL, 0-3 (default 2)", maximum: 3 },
                    include: { type: "array", description: "Only crawl URLs whose path+query contains one of these substrings" },
                    exclude: { type: "array", description: "Skip URLs whose path+query contains one of these substrings" },
                    respectRobots: { type: "boolean", description: "Honour robots.txt (default true)" },
                    maxChars: { type: "number", description: "Per-page content character cap (default 8000)" },
                },
                required: ["url"],
            },
            {
                url: "https://example.com",
                pages: [
                    { url: "https://example.com", depth: 0, status: "success", title: "Example", content: "# Example\\n\\nWelcome...", truncated: false },
                    { url: "https://example.com/about", depth: 1, status: "success", title: "About", content: "# About us...", truncated: false },
                ],
                summary: { crawled: 2, successful: 2, failed: 0, discovered: 5, limit: 10, maxDepth: 2, robotsRespected: true },
                crawledAt: "2026-07-31T12:00:00.000Z",
                requestId: "req_crawl123",
            },
            {
                properties: {
                    url: { type: "string" },
                    pages: { type: "array", description: "Per-page results with url, depth, status, title, content, truncated, error" },
                    summary: { type: "object", description: "crawled, successful, failed, discovered, limit, maxDepth, robotsRespected" },
                    crawledAt: { type: "string" },
                    requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/crawl", crawlHandler);

    // ============================================
    // /research/deep — multi-step cited research
    // ============================================
    // Priced per depth tier. ONE resolver feeds both the credit debit and the
    // x402 challenge so they can never diverge.
    const deepResearchPrice = (c: AppContext): string => {
        const body = c.get("validatedBody") as { depth?: string } | undefined;
        return body?.depth === "deep" ? PRICING.deepResearch.deep : PRICING.deepResearch.standard;
    };
    app.use(
        "/research/deep",
        validateRequest(DeepResearchRequestSchema),
        createCreditMiddleware((c) => deepResearchPrice(c as AppContext), "Deep Research"),
        createLazyPaymentMiddleware(
            "/research/deep",
            (c) => Promise.resolve(deepResearchPrice(c)),
            `Multi-step research in one call: plans sub-questions, searches each, fetches and dedupes sources, and synthesizes an answer with inline [n] citations, key findings, and gaps. ${PRICING.deepResearch.standard} standard (3 sub-questions, 8 sources) / ${PRICING.deepResearch.deep} deep (5 sub-questions, 12 sources).`,
            { query: "How are AI agents using micropayments in 2026?", depth: "standard" },
            {
                properties: {
                    query: { type: "string", description: "The research question" },
                    depth: { type: "string", enum: ["standard", "deep"], description: "standard = 3 sub-questions / 8 sources; deep = 5 / 12 (default: standard)" },
                },
                required: ["query"],
            },
            {
                query: "How are AI agents using micropayments in 2026?",
                depth: "standard",
                subQuestions: ["x402 protocol adoption 2026", "AI agent payment volume statistics", "micropayment API pricing for agents"],
                answer: "Agent micropayments consolidated around the x402 protocol in 2026 [1]. Transaction counts recovered sharply while average payment sizes fell [2][3].",
                keyFindings: ["Transaction volume is dominated by a small number of gateways", "Median per-call price sits near $0.01"],
                citations: [{ index: 1, url: "https://x402.org", title: "x402 Protocol", subQuestion: "x402 protocol adoption 2026" }],
                gaps: ["Sources did not cover settlement failure rates"],
                sourcesFetched: 8,
                researchedAt: "2026-07-31T12:00:00.000Z",
                requestId: "req_deepresearch123",
            },
            {
                properties: {
                    query: { type: "string" },
                    depth: { type: "string" },
                    subQuestions: { type: "array", description: "The sub-questions researched" },
                    answer: { type: "string", description: "Synthesized answer with inline [n] citation markers" },
                    keyFindings: { type: "array", description: "Bullet-point findings" },
                    citations: { type: "array", description: "Citations with index, url, title, subQuestion" },
                    gaps: { type: "array", description: "What the sources did not establish" },
                    sourcesFetched: { type: "number" },
                    researchedAt: { type: "string" },
                    requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/research/deep", deepResearchHandler);
}
