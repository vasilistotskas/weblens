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
    DeepResearchRequestSchema
} from "../schemas";
import { getBatchFetchPrice, parsePrice } from "../services/pricing";

// Tool Handlers
import { batchFetchHandler } from "../tools/batch-fetch";
import { compareHandler } from "../tools/compare";
import { crawlHandler } from "../tools/crawl";
import { deepResearchHandler } from "../tools/deep-research";
import { mapHandler } from "../tools/map";
import { pdfHandler } from "../tools/pdf";
import { researchHandler } from "../tools/research";
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
    // /crawl — bounded whole-site crawl
    // ============================================
    // Priced on the requested page budget. ONE resolver feeds both the credit
    // debit and the x402 challenge so they can never diverge.
    const crawlPrice = (c: AppContext): string => {
        const body = c.get("validatedBody") as { limit?: number } | undefined;
        const pages = typeof body?.limit === "number" ? body.limit : 10;
        return `$${(pages * parsePrice(PRICING.crawl.perPage)).toFixed(3)}`;
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
