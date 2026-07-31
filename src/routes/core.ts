import type { Context, Hono } from "hono";
import { PRICING } from "../config";
import {
    cacheLookupMiddleware,
    cacheServeMiddleware,
    cacheAwarePrice,
} from "../middleware/cache";
import { createCreditMiddleware } from "../middleware/credit-middleware";
import { createLazyPaymentMiddleware } from "../middleware/payment";
import { validateRequest } from "../middleware/validation";
import {
    FetchRequestSchema,
    ScreenshotRequestSchema,
    SearchRequestSchema,
    ExtractRequestSchema,
    SmartExtractRequestSchema
} from "../schemas";

// Tool Handlers
import { calculatePrice, parsePrice } from "../services/pricing";
import { getDiscount } from "../services/reputation";
import { extractData } from "../tools/extract-data";
import { fetchBasic } from "../tools/fetch-basic";
import { fetchPro } from "../tools/fetch-pro";
import { resilientFetchHandler } from "../tools/resilient-fetch";
import { screenshot } from "../tools/screenshot";
import { searchWebHandler } from "../tools/search-web";
import { smartExtractHandler } from "../tools/smart-extract";
import type { Env, Variables } from "../types";

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

/**
 * Complexity-priced resolver shared by the credit debit AND the x402
 * challenge, so the two payment paths can never charge different amounts.
 *
 * A valid body always populates `validatedBody`; the `c.req.json()` fallback
 * covers unauthenticated probes, whose invalid bodies skip validation (see
 * validation.ts `isUnpaidProbe`). When no usable URL is present we advertise
 * the BASE price — `getComplexityMultiplier` treats an unparseable URL as
 * medium complexity (1.5x), which would otherwise quote probing agents 1.5x
 * the real price for the endpoint.
 */
function dynamicUrlPrice(
    endpoint: "fetch-pro" | "extract",
    fallback: string,
): (c: AppContext) => Promise<string> {
    return async (c) => {
        try {
            const body = c.get("validatedBody") as { url?: unknown } | undefined
                ?? await c.req.json<{ url?: unknown }>();
            if (typeof body.url !== "string" || body.url === "") {
                return fallback;
            }
            const wallet = c.req.header("X-Wallet-Address") ?? c.req.header("X-CREDIT-WALLET");
            return await calculatePrice(body.url, endpoint, getDiscount(wallet));
        } catch (e) {
            c.get("log").debug("pricing.dynamic_fallback", {
                endpoint,
                error: e instanceof Error ? e.message : String(e),
            });
            return fallback;
        }
    };
}

export function registerCoreRoutes(app: Hono<{ Bindings: Env; Variables: Variables }>) {
    const fetchProPrice = cacheAwarePrice(dynamicUrlPrice("fetch-pro", PRICING.fetch.pro));
    const extractPrice = dynamicUrlPrice("extract", PRICING.extract);

    // ============================================
    // /fetch/basic - Basic tier fetch
    // ============================================
    app.use(
        "/fetch/basic",
        cacheLookupMiddleware("fetch-basic"),
        validateRequest(FetchRequestSchema),
        createCreditMiddleware(cacheAwarePrice(PRICING.fetch.basic), "Fetch Webpage (Basic)"),
        createLazyPaymentMiddleware(
            "/fetch/basic",
            cacheAwarePrice(PRICING.fetch.basic),
            "Fetch and convert any webpage to clean markdown. Fast, no JavaScript rendering. Perfect for static content, articles, and documentation.",
            { url: "https://example.com/article", timeout: 10000, cache: true, cacheTtl: 3600 },
            {
                properties: {
                    url: { type: "string", description: "URL of the webpage to fetch" },
                    timeout: { type: "number", description: "Request timeout in milliseconds (default: 10000)" },
                    cache: { type: "boolean", description: "Enable caching (default: true)" },
                    cacheTtl: { type: "number", description: "Cache TTL in seconds, 60-86400 (default: 3600)", minimum: 60, maximum: 86400 },
                },
                required: ["url"],
            },
            {
                url: "https://example.com/article",
                title: "Example Article Title",
                content: "# Article Heading\\n\\nClean markdown content...",
                tier: "basic",
                fetchedAt: "2026-01-26T12:00:00.000Z",
                requestId: "req_abc123",
            },
            {
                properties: {
                    url: { type: "string", description: "Fetched URL" },
                    title: { type: "string", description: "Page title" },
                    content: { type: "string", description: "Clean markdown content" },
                    tier: { type: "string" },
                    fetchedAt: { type: "string", description: "ISO timestamp" },
                    requestId: { type: "string" },
                },
            }
        ),
        cacheServeMiddleware()
    );
    app.post("/fetch/basic", fetchBasic);

    // ============================================
    // /fetch/pro - Pro tier fetch with full JS rendering
    // ============================================
    app.use(
        "/fetch/pro",
        cacheLookupMiddleware("fetch-pro"),
        validateRequest(FetchRequestSchema),
        createCreditMiddleware(fetchProPrice, "Fetch Webpage (Pro)"),
        createLazyPaymentMiddleware(
            "/fetch/pro",
            fetchProPrice,
            "Fetch webpage with full JavaScript rendering using headless browser. Perfect for SPAs, React/Vue apps, and dynamic content that requires JS execution.",
            { url: "https://app.example.com", waitFor: ".content", timeout: 15000, cache: true },
            {
                properties: {
                    url: { type: "string", description: "URL of the webpage to fetch" },
                    waitFor: { type: "string", description: "CSS selector to wait for before capturing content" },
                    timeout: { type: "number", description: "Request timeout in milliseconds (default: 15000)" },
                    cache: { type: "boolean", description: "Enable caching (default: true)" },
                },
                required: ["url"],
            },
            {
                url: "https://app.example.com",
                title: "Dynamic App Title",
                content: "# App Content\\n\\nRendered after JavaScript execution...",
                tier: "pro",
                fetchedAt: "2026-01-26T12:00:00.000Z",
                requestId: "req_xyz789",
            },
            {
                properties: {
                    url: { type: "string", description: "Fetched URL" },
                    title: { type: "string", description: "Page title" },
                    content: { type: "string", description: "Clean markdown content after JS rendering" },
                    tier: { type: "string" },
                    fetchedAt: { type: "string", description: "ISO timestamp" },
                    requestId: { type: "string" },
                },
            }
        ),
        cacheServeMiddleware()
    );
    app.post("/fetch/pro", fetchPro);

    // ============================================
    // /fetch/resilient - Agent Prime
    // ============================================
    app.use(
        "/fetch/resilient",
        cacheLookupMiddleware("fetch-resilient"),
        validateRequest(FetchRequestSchema),
        createCreditMiddleware(cacheAwarePrice(PRICING.fetch.resilient), "Resilient Fetch (Agent Prime)"),
        createLazyPaymentMiddleware(
            "/fetch/resilient",
            cacheAwarePrice(PRICING.fetch.resilient),
            "Resilient fetch with automatic fallback. Tries the fast native scraper first, then re-fetches through headless Chromium for client-rendered pages and sites that refuse bare HTTP clients. The response reports which tier served it.",
            { url: "https://example.com", timeout: 10000 },
            {
                properties: {
                    url: { type: "string", description: "URL of the webpage to fetch" },
                    timeout: { type: "number", description: "Request timeout in ms (default: 10000)" },
                },
                required: ["url"],
            },
            {
                url: "https://example.com",
                title: "Example Page",
                content: "# Page Content...",
                provider: { id: "weblens-native", name: "WebLens Native", isProxied: false, attemptsUsed: 1 },
                tier: "resilient",
                fetchedAt: "2026-02-16T12:00:00.000Z",
                requestId: "req_resilient_123",
            },
            {
                properties: {
                    url: { type: "string", description: "Fetched URL" },
                    title: { type: "string", description: "Page title" },
                    content: { type: "string", description: "Clean markdown content" },
                    provider: { type: "object", description: "Provider info: id, name, isProxied, attemptsUsed" },
                    tier: { type: "string" },
                    fetchedAt: { type: "string", description: "ISO timestamp" },
                    requestId: { type: "string" },
                },
            }
        ),
        cacheServeMiddleware()
    );
    app.post("/fetch/resilient", resilientFetchHandler);

    // ============================================
    // /screenshot
    // ============================================
    app.use(
        "/screenshot",
        validateRequest(ScreenshotRequestSchema),
        createCreditMiddleware(PRICING.screenshot, "Screenshot Capture"),
        createLazyPaymentMiddleware(
            "/screenshot",
            PRICING.screenshot,
            "Capture high-quality screenshots of any webpage using headless browser.",
            { url: "https://example.com", selector: ".main-content", fullPage: false, timeout: 10000 },
            {
                properties: {
                    url: { type: "string", description: "URL of the webpage to screenshot" },
                    selector: { type: "string", description: "CSS selector to capture specific element" },
                    fullPage: { type: "boolean", description: "Capture entire scrollable page (default: false)" },
                    timeout: { type: "number", description: "Timeout in ms (default: 10000)" },
                },
                required: ["url"],
            },
            {
                url: "https://example.com",
                image: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                capturedAt: "2026-01-26T12:00:00.000Z",
                requestId: "req_screen123",
            },
            {
                properties: {
                    url: { type: "string", description: "Screenshotted URL" },
                    image: { type: "string", description: "Base64-encoded PNG image" },
                    capturedAt: { type: "string", description: "ISO timestamp" },
                    requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/screenshot", screenshot);

    // ============================================
    // /search
    // ============================================
    // Base price + $0.002 per fetched-content result when includeContent is
    // set. Shared by credit AND x402 so the two paths can never diverge.
    const searchPrice = (c: AppContext): string => {
        const body = c.get("validatedBody") as
            | { includeContent?: boolean; contentResults?: number }
            | undefined;
        const base = parsePrice(PRICING.search);
        const addon = body?.includeContent
            ? (body.contentResults ?? 5) * parsePrice(PRICING.contents.perUrl)
            : 0;
        return `$${(base + addon).toFixed(4)}`;
    };
    app.use(
        "/search",
        validateRequest(SearchRequestSchema),
        createCreditMiddleware((c) => searchPrice(c as AppContext), "Web Search"),
        createLazyPaymentMiddleware(
            "/search",
            (c) => Promise.resolve(searchPrice(c)),
            "Real-time web search powered by Google. Returns ranked results with titles, URLs, and snippets. Set includeContent to also fetch the top result pages as markdown in the same call.",
            { query: "x402 payment protocol", limit: 10 },
            {
                properties: {
                    query: { type: "string", description: "Search query" },
                    limit: { type: "number", description: "Number of results to return (default: 10, max: 20)", maximum: 20 },
                    includeContent: { type: "boolean", description: "Also fetch top result pages as markdown (+$0.002/result)" },
                    contentResults: { type: "number", description: "How many top results to fetch content for (default 5, max 10)", maximum: 10 },
                    contentChars: { type: "number", description: "Per-page content character cap (default 8000)" },
                },
                required: ["query"],
            },
            {
                query: "x402 payment protocol",
                results: [
                    { title: "x402 Documentation", url: "https://x402.org", snippet: "HTTP-native micropayments..." },
                ],
                searchedAt: "2026-01-26T12:00:00.000Z",
                requestId: "req_search456",
            },
            {
                properties: {
                    query: { type: "string", description: "Original search query" },
                    results: { type: "array", description: "Array of search results with title, url, snippet" },
                    searchedAt: { type: "string", description: "ISO timestamp" },
                    requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/search", searchWebHandler);

    // ============================================
    // /extract
    // ============================================
    app.use(
        "/extract",
        validateRequest(ExtractRequestSchema),
        createCreditMiddleware(extractPrice, "Structured Data Extraction"),
        createLazyPaymentMiddleware(
            "/extract",
            extractPrice,
            "Extract structured data from any webpage using JSON schema. AI-powered extraction that understands page context.",
            { url: "https://example.com/product", schema: { name: { type: "string" }, price: { type: "number" } }, instructions: "Extract product details" },
            {
                properties: {
                    url: { type: "string", description: "URL of the webpage to extract from" },
                    schema: { type: "object", description: "JSON schema defining the data structure to extract" },
                    instructions: { type: "string", description: "Natural language instructions to guide extraction" },
                },
                required: ["url", "schema"],
            },
            {
                url: "https://example.com/product",
                data: { name: "Product Name", price: 99.99, inStock: true },
                extractedAt: "2026-01-26T12:00:00.000Z",
                requestId: "req_extract789",
            },
            {
                properties: {
                    url: { type: "string", description: "Source URL" },
                    data: { type: "object", description: "Extracted data matching the provided schema" },
                    extractedAt: { type: "string", description: "ISO timestamp" },
                    requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/extract", extractData);

    // ============================================
    // /extract/smart
    // ============================================
    app.use(
        "/extract/smart",
        validateRequest(SmartExtractRequestSchema),
        createCreditMiddleware(PRICING.smartExtract, "Smart Extraction (AI)"),
        createLazyPaymentMiddleware(
            "/extract/smart",
            PRICING.smartExtract,
            "AI-powered data extraction using natural language. No schema needed - just describe what you want to extract in plain English.",
            { url: "https://example.com/contact", query: "find all email addresses", format: "json" },
            {
                properties: {
                    url: { type: "string", description: "URL of the webpage to extract from" },
                    query: { type: "string", description: "Natural language description of what to extract" },
                    format: { type: "string", description: "Output format: json or text (default: json)" },
                },
                required: ["url", "query"],
            },
            {
                url: "https://example.com/contact",
                query: "find all email addresses",
                data: [
                    { value: "contact@example.com", context: "Contact page footer", confidence: 0.95 },
                ],
                explanation: "Found 1 email address",
                extractedAt: "2026-01-26T12:00:00.000Z",
                requestId: "req_smart789",
            },
            {
                properties: {
                    url: { type: "string" },
                    query: { type: "string" },
                    data: { type: "array", description: "Array of extracted items with value, context, confidence" },
                    explanation: { type: "string", description: "AI explanation of extraction" },
                    extractedAt: { type: "string" },
                    requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/extract/smart", smartExtractHandler);
}
