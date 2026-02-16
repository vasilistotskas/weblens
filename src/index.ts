/**
 * WebLens - Premium Web Intelligence API
 * Main application entry point with x402 payment middleware
 *
 * Requirements: All
 */

import { createFacilitatorConfig } from "@coinbase/x402";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { RoutesConfig } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { paymentMiddleware } from "@x402/hono";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Address } from "viem";
import { PRICING, SUPPORTED_NETWORKS } from "./config";
import { errorHandlerMiddleware } from "./middleware/errorHandler";
import { paymentDebugMiddleware } from "./middleware/payment-debug";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { requestIdMiddleware } from "./middleware/requestId";
import { securityMiddleware } from "./middleware/security";
import { registerOpenAPIRoutes } from "./openapi";
import { batchFetchHandler } from "./tools/batch-fetch";
import { compareHandler } from "./tools/compare";
import { discoveryHandler, wellKnownX402Handler } from "./tools/discovery";
import { extractData } from "./tools/extract-data";
import { fetchBasic } from "./tools/fetch-basic";
import { fetchPro } from "./tools/fetch-pro";
import { freeFetch, freeSearch } from "./tools/free";
import { health } from "./tools/health";
import { mcpPostHandler, mcpGetHandler, mcpInfoHandler } from "./tools/mcp";
import { memorySetHandler, memoryGetHandler, memoryDeleteHandler, memoryListHandler } from "./tools/memory";
import { monitorCreateHandler, monitorGetHandler, monitorDeleteHandler } from "./tools/monitor";
import { pdfHandler } from "./tools/pdf";
import { researchHandler } from "./tools/research";
import { screenshot } from "./tools/screenshot";
import { searchWeb } from "./tools/search-web";
import { smartExtractHandler } from "./tools/smart-extract";
import type { Env } from "./types";

// ============================================
// CDP Facilitator Configuration (x402 v2)
// ============================================
// 
// IMPORTANT: In Cloudflare Workers, environment variables from wrangler.toml [vars]
// are available at MODULE INITIALIZATION time as global variables.
// 
// The @x402/hono middleware requires the facilitator config at module init time,
// so we read the CDP API keys from the global scope where Cloudflare injects them.
// ============================================

// Cloudflare Workers injects [vars] as globals at module init time
declare const globalThis: typeof global & {
    PAY_TO_ADDRESS?: string;
    CDP_API_KEY_ID?: string;
    CDP_API_KEY_SECRET?: string;
    NETWORK?: string;
};

// Payment receiving address - this is where all x402 payments go
// IMPORTANT: Must be different from payer addresses (CDP rejects self-payments)
const PAY_TO_ADDRESS: string | undefined = globalThis.PAY_TO_ADDRESS
    ?? process.env.PAY_TO_ADDRESS ?? undefined

if (!PAY_TO_ADDRESS) {
    throw new Error("PAY_TO_ADDRESS is required");
}

// Network configuration - "base" for mainnet, "base-sepolia" for testnet
const NETWORK: string = globalThis.NETWORK ?? process.env.NETWORK ?? "base";
const IS_TESTNET = NETWORK === "base-sepolia";

// CDP API keys - defined in wrangler.toml [vars]
const cdpApiKeyId: string | undefined = globalThis.CDP_API_KEY_ID ?? process.env.CDP_API_KEY_ID;
const cdpApiKeySecret: string | undefined = globalThis.CDP_API_KEY_SECRET ?? process.env.CDP_API_KEY_SECRET;

console.log("� Payment address:", PAY_TO_ADDRESS);
console.log("⛓️  Network:", NETWORK, IS_TESTNET ? "(TESTNET)" : "(MAINNET)");
console.log("🔍 CDP_API_KEY_ID available:", !!cdpApiKeyId);
console.log("🔍 CDP_API_KEY_SECRET available:", !!cdpApiKeySecret);

if (cdpApiKeyId && cdpApiKeySecret) {
    console.log("🔑 CDP API Key ID:", cdpApiKeyId.substring(0, 8) + "...");
} else {
    throw new Error("CDP_API_KEY_ID and CDP_API_KEY_SECRET are required");
}

// For Base Sepolia (testnet): eip155:84532
// For Base mainnet: eip155:8453
const NETWORK_CAIP2 = IS_TESTNET ? "eip155:84532" : "eip155:8453";

console.log("🚀 Facilitator will be:", IS_TESTNET
    ? "x402.org (TESTNET - fake money)"
    : (cdpApiKeyId && cdpApiKeySecret ? "CDP (Bazaar enabled)" : "PayAI"));
console.log("🌐 Network CAIP-2:", NETWORK_CAIP2);

// ============================================
// Lazy Resource Server Initialization
// ============================================
// CRITICAL: Cloudflare Workers cannot call fetch() during module initialization.
// The paymentMiddleware calls facilitator's /supported endpoint during init,
// which uses fetch(). We must defer this until the first request.
//
// Verified by test-middleware-init.js which shows fetch() is called during init.
// ============================================

let resourceServer: x402ResourceServer | null = null;

function getResourceServer(): x402ResourceServer {
    if (resourceServer) {
        return resourceServer;
    }

    console.log("🔧 [First Request] Initializing x402 resource server...");

    // Create facilitator client
    const facilitatorClient = IS_TESTNET
        ? new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" })
        : cdpApiKeyId && cdpApiKeySecret
            ? new HTTPFacilitatorClient(createFacilitatorConfig(cdpApiKeyId, cdpApiKeySecret))
            : new HTTPFacilitatorClient({ url: "https://facilitator.payai.network" });

    // Create and configure resource server
    resourceServer = new x402ResourceServer(facilitatorClient);
    resourceServer.register(NETWORK_CAIP2, new ExactEvmScheme());
    resourceServer.registerExtension(bazaarResourceServerExtension);

    console.log("✅ [First Request] x402 resource server initialized");
    console.log("   Facilitator:", IS_TESTNET ? "x402.org" : (cdpApiKeyId ? "CDP" : "PayAI"));
    console.log("   Bazaar extension registered for discovery");

    return resourceServer;
}

// Helper function to create v2 payment middleware config with Bazaar discovery
function createPaymentConfig(
    path: string,
    price: string,
    description: string,
    inputExample?: Record<string, unknown>,
    inputSchema?: {
        properties?: Record<string, { type: string; description?: string; maxLength?: number; minimum?: number; maximum?: number }>;
        required?: string[];
    },
    outputExample?: Record<string, unknown>,
    outputSchema?: {
        properties?: Record<string, { type: string; description?: string }>;
        required?: string[];
    }
): RoutesConfig {
    return {
        [path]: {
            accepts: [{
                scheme: "exact" as const,
                price,
                network: NETWORK_CAIP2,
                payTo: PAY_TO_ADDRESS as Address,
            }],
            description,
            mimeType: "application/json" as const,
            extensions: {
                ...declareDiscoveryExtension({
                    bodyType: "json" as const, // POST endpoints use JSON body
                    ...(inputExample && { input: inputExample }),
                    ...(inputSchema && { inputSchema }),
                    ...(outputExample && outputSchema && {
                        output: {
                            example: outputExample,
                            schema: outputSchema,
                        }
                    }),
                }),
            },
        },
    };
}

// ============================================
// Lazy Payment Middleware Factory
// ============================================
// Creates a middleware that defers paymentMiddleware initialization until first request.
// This is required for Cloudflare Workers because paymentMiddleware calls fetch()
// during initialization to validate supported networks with the facilitator.
//
// Returns MiddlewareHandler type from Hono (same as paymentMiddleware return type).
// ============================================

function createLazyPaymentMiddleware(
    path: string,
    price: string,
    description: string,
    inputExample?: Parameters<typeof createPaymentConfig>[3],
    inputSchema?: Parameters<typeof createPaymentConfig>[4],
    outputExample?: Parameters<typeof createPaymentConfig>[5],
    outputSchema?: Parameters<typeof createPaymentConfig>[6]
): MiddlewareHandler {
    let middleware: MiddlewareHandler | null = null;

    return async (c, next) => {
        if (!middleware) {
            console.log(`🔧 [First Request] Initializing payment middleware for ${path}...`);
            const config = createPaymentConfig(path, price, description, inputExample, inputSchema, outputExample, outputSchema);
            const server = getResourceServer();
            middleware = paymentMiddleware(config, server);
            console.log(`✅ [First Request] Payment middleware initialized for ${path}`);
        }

        return middleware(c, next);
    };
}

const app = new Hono<{ Bindings: Env }>();

// ============================================
// Global Middleware Chain
// ============================================

// Logging
app.use("*", logger());

// CORS
app.use("*", cors());

// Payment debugging (helps track payment verification issues)
app.use("*", paymentDebugMiddleware);

// Request ID and processing time tracking
// Requirement 5.3: Include X-Request-Id and X-Processing-Time headers
app.use("*", requestIdMiddleware);

// Global error handler
// Requirement 5.4: Consistent error response format
app.use("*", errorHandlerMiddleware);

// Security headers
app.use("*", securityMiddleware);


// ============================================
// OpenAPI Documentation Routes
// Requirement 5.1, 8.3, 8.4: Auto-generated API documentation
// ============================================
registerOpenAPIRoutes(app);

// ============================================
// Discovery Endpoints (free)
// Optimized for Bazaar indexing and AI agent discovery
// ============================================
app.get("/discovery", discoveryHandler);
app.get("/.well-known/x402", wellKnownX402Handler);

// API Documentation (free) - JSON summary
app.get("/", (c) => {
    return c.json({
        name: "WebLens",
        version: "2.0.0",
        description: "Premium Web Intelligence API - Give your AI agents web superpowers with x402 micropayments",
        tagline: "Web scraping, research, and data extraction for AI agents",
        documentation: {
            interactive: "/docs",
            openapi: "/openapi.json",
            llms: "/llms.txt",
            discovery: "/discovery",
            wellKnown: "/.well-known/x402",
        },
        mcp: {
            remote: "/mcp",
            info: "/mcp/info",
            local: "npx -y weblens-mcp",
        },
        supportedNetworks: SUPPORTED_NETWORKS,
        x402: {
            version: 1,
            protocol: "https://x402.org",
            facilitator: "CDP (Coinbase)",
            description: "HTTP-native micropayments using 402 Payment Required",
            bazaarListed: true,
        },
        freeTier: {
            description: "Try WebLens free — no wallet or payment needed",
            endpoints: [
                { path: "/free/fetch", method: "POST", description: "Fetch any webpage (truncated to 2000 chars)", limit: "10 requests/hour" },
                { path: "/free/search", method: "POST", description: "Web search (max 3 results)", limit: "10 requests/hour" },
            ],
            rateLimit: "10 requests/hour per IP",
            upgrade: "Use paid endpoints for full content and unlimited access",
        },
        capabilities: [
            "web-scraping",
            "javascript-rendering",
            "screenshot-capture",
            "web-search",
            "data-extraction",
            "ai-research",
            "pdf-extraction",
            "url-monitoring",
            "agent-memory",
        ],
    });
});

// Health check endpoint (free)
// Requirement 5.2: Return system health status
app.get("/health", health);

// ============================================
// Free Tier Endpoints (no payment required)
// Rate-limited access to demonstrate value
// ============================================
app.post("/free/fetch", rateLimitMiddleware, freeFetch);
app.post("/free/search", rateLimitMiddleware, freeSearch);


// ============================================
// POST-only enforcement middleware
// Returns 405 for non-POST requests on paid endpoints
// Must run BEFORE payment middleware to prevent 402 on GET requests
// ============================================
const PAID_ENDPOINTS = [
    "/fetch/basic", "/fetch/pro", "/screenshot", "/search", "/extract",
    "/batch/fetch", "/research", "/extract/smart", "/pdf", "/compare",
    "/monitor/create", "/memory/set"
];

app.use("*", async (c, next) => {
    const path = c.req.path;
    const method = c.req.method;

    // Check if this is a paid endpoint that requires POST
    if (PAID_ENDPOINTS.includes(path) && method !== "POST") {
        return c.json({
            error: "Method Not Allowed",
            message: "This endpoint only accepts POST requests. Please send a POST request with the required JSON body.",
            method: method,
            path: path,
            allowedMethods: ["POST"],
        }, 405, {
            "Allow": "POST",
        });
    }

    await next();
});

// ============================================
// x402 Payment Middleware for all endpoints
// Requirement 4.1: Multi-chain payment support
// Requirement 4.2: CDP facilitator for Base (REQUIRED for Bazaar discovery)
// Requirement 4.3: PayAI facilitator for Solana/Polygon (future multi-chain support)
//
// IMPORTANT: All Base network endpoints MUST use CDP_FACILITATOR to be
// automatically listed in the Coinbase Bazaar discovery catalog
// ============================================

// /fetch/basic - Basic tier fetch without JS rendering
app.use(
    "/fetch/basic",
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
            content: "# Article Heading\n\nClean markdown content...",
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

// /fetch/pro - Pro tier fetch with full JS rendering
app.use(
    "/fetch/pro",
    createLazyPaymentMiddleware(
        "/fetch/pro",
        PRICING.fetch.pro,
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
            content: "# App Content\n\nRendered after JavaScript execution...",
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

// /screenshot - Capture webpage screenshots
app.use(
    "/screenshot",
    createLazyPaymentMiddleware(
        "/screenshot",
        PRICING.screenshot,
        "Capture high-quality screenshots of any webpage using headless browser. Supports custom viewport sizes, full-page capture, and element-specific screenshots.",
        { url: "https://example.com", selector: ".main-content", fullPage: false, timeout: 10000 },
        {
            properties: {
                url: { type: "string", description: "URL of the webpage to screenshot" },
                selector: { type: "string", description: "CSS selector to capture specific element" },
                fullPage: { type: "boolean", description: "Capture entire scrollable page (default: false)" },
                timeout: { type: "number", description: "Timeout in ms, 5000-30000 (default: 10000)", minimum: 5000, maximum: 30000 },
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

// /search - Real-time web search
app.use(
    "/search",
    createLazyPaymentMiddleware(
        "/search",
        PRICING.search,
        "Real-time web search powered by Google. Returns ranked results with titles, URLs, and snippets. Perfect for AI agents needing current information.",
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
                { title: "Getting Started", url: "https://x402.org/docs", snippet: "Learn how to integrate..." },
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

// /extract - Structured data extraction
app.use(
    "/extract",
    createLazyPaymentMiddleware(
        "/extract",
        PRICING.extract,
        "Extract structured data from any webpage using JSON schema. AI-powered extraction that understands page context. Great for scraping product info, articles, contacts, etc.",
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

// ============================================
// Advanced Endpoint Payment Middleware
// Requirements: 1.4, 2.6, 3.5, 4.2, 5.4, 6.4, 7.2, 8.1
// ============================================

// /batch/fetch - Batch URL fetching
// Note: Price is per-URL, middleware uses base price for 2 URLs minimum
app.use(
    "/batch/fetch",
    createLazyPaymentMiddleware(
        "/batch/fetch",
        "$0.006", // Minimum price for 2 URLs
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

// /research - One-stop research
app.use(
    "/research",
    createLazyPaymentMiddleware(
        "/research",
        PRICING.research,
        "One-stop research assistant: searches the web, fetches top results, and generates an AI-powered summary with key findings. Perfect for quick research tasks.",
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
            summary: "x402 is an open payment protocol that enables instant crypto payments for API access...",
            keyFindings: ["Zero fees", "Instant settlement", "No accounts needed"],
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

// /extract/smart - AI-powered smart extraction
app.use(
    "/extract/smart",
    createLazyPaymentMiddleware(
        "/extract/smart",
        PRICING.smartExtract,
        "AI-powered data extraction using natural language. No schema needed - just describe what you want to extract in plain English.",
        { url: "https://example.com/contact", query: "find all email addresses", format: "json" },
        {
            properties: {
                url: { type: "string", description: "URL of the webpage to extract from" },
                query: { type: "string", description: "Natural language description of what to extract (e.g., 'find all email addresses')", maxLength: 500 },
                format: { type: "string", description: "Output format: json or text (default: json)" },
            },
            required: ["url", "query"],
        },
        {
            url: "https://example.com/contact",
            query: "find all email addresses",
            data: [
                { value: "contact@example.com", context: "Contact page footer", confidence: 0.95 },
                { value: "support@example.com", context: "Support section", confidence: 0.92 },
            ],
            explanation: "Found 2 email addresses in the contact page",
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

// /pdf - PDF text extraction
app.use(
    "/pdf",
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
                { pageNumber: 2, content: "Page 2 text content..." },
            ],
            fullText: "Page 1 text content... Page 2 text content...",
            extractedAt: "2026-01-26T12:00:00.000Z",
            requestId: "req_pdf123",
        },
        {
            properties: {
                url: { type: "string" },
                metadata: { type: "object", description: "PDF metadata with title, author, pageCount" },
                pages: { type: "array", description: "Array of pages with pageNumber and content" },
                fullText: { type: "string", description: "All pages concatenated" },
                extractedAt: { type: "string" },
                requestId: { type: "string" },
            },
        }
    )
);

// /compare - URL comparison
app.use(
    "/compare",
    createLazyPaymentMiddleware(
        "/compare",
        PRICING.compare,
        "Compare 2-3 webpages with AI-generated analysis. Identifies similarities, differences, and provides a comprehensive summary. Great for product comparisons, article analysis, etc.",
        { urls: ["https://product-a.com", "https://product-b.com"], focus: "pricing and features" },
        {
            properties: {
                urls: { type: "array", description: "Array of 2-3 URLs to compare" },
                focus: { type: "string", description: "What aspect to focus the comparison on (e.g., 'pricing', 'features')" },
            },
            required: ["urls"],
        },
        {
            sources: [
                { url: "https://product-a.com", title: "Product A", content: "Features: X, Y, Z..." },
                { url: "https://product-b.com", title: "Product B", content: "Features: A, B, C..." },
            ],
            comparison: {
                similarities: ["Both offer feature X", "Similar pricing models"],
                differences: ["Product A has Z, Product B has C"],
                summary: "Product A focuses on simplicity while Product B offers more advanced features...",
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

// /monitor/create - Create URL monitor
app.use(
    "/monitor/create",
    createLazyPaymentMiddleware(
        "/monitor/create",
        PRICING.monitor.setup,
        "Create a URL monitor for change detection. Get notified via webhook when page content or status changes. Supports 1-24 hour check intervals.",
        { url: "https://example.com/status", webhookUrl: "https://your-app.com/webhook", checkInterval: 1, notifyOn: "any" },
        {
            properties: {
                url: { type: "string", description: "URL to monitor for changes" },
                webhookUrl: { type: "string", description: "Webhook URL to receive change notifications" },
                checkInterval: { type: "number", description: "Check interval in hours, 1-24 (default: 1)", minimum: 1, maximum: 24 },
                notifyOn: { type: "string", description: "What triggers notification: any, content, or status (default: any)" },
            },
            required: ["url", "webhookUrl"],
        },
        {
            monitorId: "mon_abc123xyz",
            url: "https://example.com/status",
            webhookUrl: "https://your-app.com/webhook",
            checkInterval: 1,
            nextCheckAt: "2026-01-26T13:00:00.000Z",
            createdAt: "2026-01-26T12:00:00.000Z",
            requestId: "req_monitor789",
        },
        {
            properties: {
                monitorId: { type: "string" },
                url: { type: "string" },
                webhookUrl: { type: "string" },
                checkInterval: { type: "number" },
                nextCheckAt: { type: "string" },
                createdAt: { type: "string" },
                requestId: { type: "string" },
            },
        }
    )
);

// /memory/set - Store value
app.use(
    "/memory/set",
    createLazyPaymentMiddleware(
        "/memory/set",
        PRICING.memory.write,
        "Store a value in persistent key-value storage. Perfect for AI agents to remember context across sessions. Supports JSON values up to 100KB with configurable TTL.",
        { key: "user_preferences", value: { theme: "dark", language: "en" }, ttl: 168 },
        {
            properties: {
                key: { type: "string", description: "Storage key (max 256 chars)", maxLength: 256 },
                value: { type: "object", description: "JSON-serializable value (max 100KB)" },
                ttl: { type: "number", description: "Time-to-live in hours, 1-720 (default: 168 = 7 days)", minimum: 1, maximum: 720 },
            },
            required: ["key", "value"],
        },
        {
            key: "user_preferences",
            stored: true,
            expiresAt: "2026-02-02T12:00:00.000Z",
            requestId: "req_memory123",
        },
        {
            properties: {
                key: { type: "string" },
                stored: { type: "boolean" },
                expiresAt: { type: "string" },
                requestId: { type: "string" },
            },
        }
    )
);

// /memory/get/* - Retrieve value
app.use(
    "/memory/get/*",
    createLazyPaymentMiddleware(
        "/memory/get/*",
        PRICING.memory.read,
        "Retrieve a stored value by key from persistent storage. Use GET /memory/get/{key} to fetch previously stored data.",
        undefined,
        undefined,
        {
            key: "user_preferences",
            value: { theme: "dark", language: "en" },
            expiresAt: "2026-02-02T12:00:00.000Z",
            requestId: "req_memget789",
        },
        {
            properties: {
                key: { type: "string" },
                value: { type: "object", description: "Stored JSON value" },
                expiresAt: { type: "string" },
                requestId: { type: "string" },
            },
        }
    )
);

// /memory/list - List keys
app.use(
    "/memory/list",
    createLazyPaymentMiddleware(
        "/memory/list",
        PRICING.memory.read,
        "List all stored keys for the current wallet. Returns all active keys in your persistent storage namespace.",
        undefined,
        undefined,
        {
            keys: ["user_preferences", "session_data", "cache_config"],
            count: 3,
            requestId: "req_memlist456",
        },
        {
            properties: {
                keys: { type: "array", description: "Array of stored keys" },
                count: { type: "number" },
                requestId: { type: "string" },
            },
        }
    )
);


// ============================================
// Route Handlers
// ============================================

// Tiered fetch endpoints
app.post("/fetch/basic", fetchBasic);
app.post("/fetch/pro", fetchPro);

// Screenshot endpoint
app.post("/screenshot", screenshot);

// Other paid endpoints
app.post("/search", searchWeb);
app.post("/extract", extractData);

// ============================================
// Advanced Route Handlers
// ============================================

// Batch fetch endpoint
app.post("/batch/fetch", batchFetchHandler);

// Research endpoint
app.post("/research", researchHandler);

// Smart extraction endpoint
app.post("/extract/smart", smartExtractHandler);

// PDF extraction endpoint
app.post("/pdf", pdfHandler);

// Compare endpoint
app.post("/compare", compareHandler);

// Monitor endpoints
app.post("/monitor/create", monitorCreateHandler);
app.get("/monitor/:id", monitorGetHandler);
app.delete("/monitor/:id", monitorDeleteHandler);

// Memory endpoints
app.post("/memory/set", memorySetHandler);
app.get("/memory/get/:key", memoryGetHandler);
app.delete("/memory/:key", memoryDeleteHandler);
app.get("/memory/list", memoryListHandler);

// ============================================
// MCP (Model Context Protocol) Endpoint
// Allows AI agents to connect via HTTP transport
// ============================================
app.post("/mcp", mcpPostHandler);
app.get("/mcp", mcpGetHandler);
app.get("/mcp/info", mcpInfoHandler);

// Export Durable Object class for wrangler
export { MonitorScheduler } from "./services/scheduler";

export default app;
