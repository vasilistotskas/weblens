import type { Hono } from "hono";
import { PRICING } from "../config";
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
import { calculatePrice } from "../services/pricing";
import { getDiscount } from "../services/reputation";
import { extractData } from "../tools/extract-data";
import { fetchBasic } from "../tools/fetch-basic";
import { fetchPro } from "../tools/fetch-pro";
import { resilientFetchHandler } from "../tools/resilient-fetch";
import { screenshot } from "../tools/screenshot";
import { searchWeb } from "../tools/search-web";
import { smartExtractHandler } from "../tools/smart-extract";
import type { Env, Variables } from "../types";

export function registerCoreRoutes(app: Hono<{ Bindings: Env; Variables: Variables }>) {

    // ============================================
    // /fetch/basic - Basic tier fetch
    // ============================================
    app.use(
        "/fetch/basic",
        createCreditMiddleware(PRICING.fetch.basic, "Fetch Webpage (Basic)"),
        validateRequest(FetchRequestSchema), // New Zod Validation
        createLazyPaymentMiddleware(
            "/fetch/basic",
            PRICING.fetch.basic,
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
        )
    );
    app.post("/fetch/basic", fetchBasic);

    // ============================================
    // /fetch/pro - Pro tier fetch with full JS rendering
    // ============================================
    app.use(
        "/fetch/pro",
        createCreditMiddleware(PRICING.fetch.pro, "Fetch Webpage (Pro)"),
        validateRequest(FetchRequestSchema),
        createLazyPaymentMiddleware(
            "/fetch/pro",
            async (c) => {
                // Peek at the request body to get URL for pricing
                try {
                    // Use validatedBody if available to avoid re-parsing
                    const validated = c.get("validatedBody") as { url: string } | undefined;
                    const body: { url: string } = validated ?? await c.req.json();
                    const walletAddress = c.req.header("X-Wallet-Address");
                    const discount = getDiscount(walletAddress);
                    return await calculatePrice(body.url, "fetch-pro", discount);
                } catch (e) {
                    console.warn("Failed to parse body for dynamic pricing, using base price", e);
                    return PRICING.fetch.pro;
                }
            },
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
        )
    );
    app.post("/fetch/pro", fetchPro);

    // ============================================
    // /fetch/resilient - Agent Prime
    // ============================================
    app.use(
        "/fetch/resilient",
        createCreditMiddleware(PRICING.fetch.resilient, "Resilient Fetch (Agent Prime)"),
        validateRequest(FetchRequestSchema),
        createLazyPaymentMiddleware(
            "/fetch/resilient",
            PRICING.fetch.resilient,
            "Resilient fetch with automatic provider fallback. Tries WebLens native scraper first, then falls back to Firecrawl and Zyte via x402.",
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
        )
    );
    app.post("/fetch/resilient", resilientFetchHandler);

    // ============================================
    // /screenshot
    // ============================================
    app.use(
        "/screenshot",
        createCreditMiddleware(PRICING.screenshot, "Screenshot Capture"),
        validateRequest(ScreenshotRequestSchema),
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
    app.use(
        "/search",
        createCreditMiddleware(PRICING.search, "Web Search"),
        validateRequest(SearchRequestSchema),
        createLazyPaymentMiddleware(
            "/search",
            PRICING.search,
            "Real-time web search powered by Google. Returns ranked results with titles, URLs, and snippets.",
            { query: "x402 payment protocol", limit: 10 },
            {
                properties: {
                    query: { type: "string", description: "Search query" },
                    limit: { type: "number", description: "Number of results to return (default: 10, max: 20)", maximum: 20 },
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
    app.post("/search", searchWeb);

    // ============================================
    // /extract
    // ============================================
    app.use(
        "/extract",
        createCreditMiddleware(PRICING.extract, "Structured Data Extraction"),
        validateRequest(ExtractRequestSchema),
        createLazyPaymentMiddleware(
            "/extract",
            async (c) => {
                try {
                    const validated = c.get("validatedBody") as { url: string } | undefined;
                    const body: { url: string } = validated ?? await c.req.json();
                    const walletAddress = c.req.header("X-Wallet-Address");
                    const discount = getDiscount(walletAddress);
                    return await calculatePrice(body.url, "extract", discount);
                } catch (e) {
                    console.warn("Failed to parse body for dynamic pricing, using base price", e);
                    return PRICING.extract;
                }
            },
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
        createCreditMiddleware(PRICING.smartExtract, "Smart Extraction (AI)"),
        validateRequest(SmartExtractRequestSchema),
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
