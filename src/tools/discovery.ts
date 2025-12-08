/**
 * Discovery Endpoint for AI Agents
 * Provides machine-readable service catalog optimized for Bazaar and agent discovery
 */

import type { Context } from "hono";
import { PRICING } from "../config";
import type { Env } from "../types";

// Service catalog with rich metadata for AI agent discovery
export const SERVICE_CATALOG = {
    name: "WebLens",
    version: "2.0.0",
    tagline: "Give your AI agents web superpowers",
    description: "Premium Web Intelligence API - Give your AI agents web superpowers with x402 micropayments. No API keys, no accounts, just pay per request with USDC on Base.",
    baseUrl: "https://api.weblens.dev",
    protocol: {
        name: "x402",
        version: 1,
        network: "base",
        token: "USDC",
        facilitator: "CDP",
        bazaarListed: true,
    },
    documentation: {
        interactive: "/docs",
        openapi: "/openapi.json",
        llms: "/llms.txt",
        mcp: "/mcp/info",
    },
    whyChooseUs: [
        "Zero friction - No accounts, API keys, or subscriptions",
        "AI-optimized - Structured outputs designed for autonomous agents",
        "Instant settlement - Payments settle in ~1-2 seconds on Base",
        "No fees - x402 protocol has 0 platform fees",
        "Bazaar listed - Discoverable via Coinbase Bazaar",
        "MCP support - Native Model Context Protocol integration",
        "Cache discount - 70% off for cached responses",
    ],
    capabilities: [
        "web-scraping",
        "javascript-rendering",
        "screenshot-capture",
        "web-search",
        "data-extraction",
        "ai-powered-analysis",
        "pdf-extraction",
        "url-monitoring",
        "persistent-memory",
        "batch-operations",
        "url-comparison",
    ],
    useCases: [
        "AI agent web browsing and research",
        "Automated fact-checking and verification",
        "Content aggregation and monitoring",
        "Competitive intelligence gathering",
        "Lead generation and data mining",
        "Visual testing and archiving",
        "Document processing and extraction",
        "Multi-source comparison analysis",
        "Persistent agent memory across sessions",
    ],
    services: [
        {
            endpoint: "/fetch/basic",
            method: "POST",
            name: "Fetch Webpage (Basic)",
            description: "Fast webpage to markdown conversion without JavaScript rendering",
            price: PRICING.fetch.basic,
            tags: ["web-scraping", "markdown", "fast", "static-content"],
            latency: "1-3 seconds",
            rateLimit: "100/minute",
        },
        {
            endpoint: "/fetch/pro",
            method: "POST",
            name: "Fetch Webpage (Pro)",
            description: "Full JavaScript rendering with headless Chromium for SPAs and dynamic content",
            price: PRICING.fetch.pro,
            tags: ["web-scraping", "javascript", "spa", "dynamic-content"],
            latency: "3-8 seconds",
            rateLimit: "50/minute",
        },
        {
            endpoint: "/screenshot",
            method: "POST",
            name: "Screenshot Capture",
            description: "High-quality PNG screenshots with custom viewports and element targeting",
            price: PRICING.screenshot,
            tags: ["screenshot", "visual", "image", "archiving"],
            latency: "2-5 seconds",
            rateLimit: "50/minute",
        },
        {
            endpoint: "/search",
            method: "POST",
            name: "Web Search",
            description: "Real-time Google-powered web search with ranked results",
            price: PRICING.search,
            tags: ["search", "google", "real-time", "information-retrieval"],
            latency: "1-2 seconds",
            rateLimit: "100/minute",
        },
        {
            endpoint: "/extract",
            method: "POST",
            name: "Structured Data Extraction",
            description: "Extract data using JSON schema with AI-powered understanding",
            price: PRICING.extract,
            tags: ["extraction", "structured-data", "json-schema", "ai-powered"],
            latency: "3-6 seconds",
            rateLimit: "50/minute",
        },
        {
            endpoint: "/extract/smart",
            method: "POST",
            name: "Smart Extraction",
            description: "Natural language data extraction - just describe what you want",
            price: PRICING.smartExtract,
            tags: ["extraction", "natural-language", "ai-powered", "flexible"],
            latency: "4-8 seconds",
            rateLimit: "30/minute",
        },
        {
            endpoint: "/research",
            method: "POST",
            name: "AI Research Assistant",
            description: "One-stop research: search + fetch + AI summary with key findings",
            price: PRICING.research,
            tags: ["research", "ai-summary", "analysis", "comprehensive"],
            latency: "10-30 seconds",
            rateLimit: "20/minute",
        },
        {
            endpoint: "/batch/fetch",
            method: "POST",
            name: "Batch Fetch",
            description: "Fetch 2-20 URLs in parallel for efficient bulk operations",
            price: `${PRICING.batchFetch.perUrl}/URL`,
            tags: ["batch", "parallel", "bulk", "efficient"],
            latency: "5-15 seconds",
            rateLimit: "20/minute",
        },
        {
            endpoint: "/pdf",
            method: "POST",
            name: "PDF Extraction",
            description: "Extract text and metadata from PDF documents",
            price: PRICING.pdf,
            tags: ["pdf", "document", "text-extraction", "metadata"],
            latency: "2-10 seconds",
            rateLimit: "30/minute",
        },
        {
            endpoint: "/compare",
            method: "POST",
            name: "URL Comparison",
            description: "AI-powered comparison of 2-3 webpages with similarity analysis",
            price: PRICING.compare,
            tags: ["comparison", "analysis", "ai-powered", "diff"],
            latency: "10-20 seconds",
            rateLimit: "20/minute",
        },
        {
            endpoint: "/monitor/create",
            method: "POST",
            name: "URL Monitor",
            description: "Create change detection monitors with webhook notifications",
            price: PRICING.monitor.setup,
            tags: ["monitoring", "change-detection", "webhook", "alerts"],
            latency: "1-2 seconds",
            rateLimit: "50/minute",
        },
        {
            endpoint: "/memory/set",
            method: "POST",
            name: "Memory Storage",
            description: "Persistent key-value storage for AI agent context",
            price: PRICING.memory.write,
            tags: ["memory", "storage", "persistence", "agent-context"],
            latency: "<1 second",
            rateLimit: "100/minute",
        },
    ],
    pricing: {
        currency: "USDC",
        network: "base",
        cacheDiscount: "70% off for cached responses",
        noFees: "x402 protocol has 0 fees",
        instantSettlement: "~1-2 seconds on Base",
        priceRange: "$0.0005 - $0.08 per request",
    },
    integration: {
        mcp: {
            remote: "https://api.weblens.dev/mcp",
            local: "npx -y weblens-mcp",
            description: "Model Context Protocol for AI agents (Claude, Kiro, etc.)",
        },
        http: {
            baseUrl: "https://api.weblens.dev",
            auth: "x402 payment via X-PAYMENT header",
        },
    },
    agentQuickStart: {
        step1: "Call any endpoint (e.g., POST /fetch/basic with {url: 'https://example.com'})",
        step2: "Receive 402 Payment Required with payment details in JSON body",
        step3: "Sign USDC payment using your wallet (Base network)",
        step4: "Retry with X-PAYMENT header containing signed payload",
        step5: "Receive data with X-PAYMENT-RESPONSE settlement proof",
    },
};

/**
 * Discovery endpoint handler - returns full service catalog
 */
export function discoveryHandler(c: Context<{ Bindings: Env }>) {
    const baseUrl = new URL(c.req.url).origin;
    
    return c.json({
        ...SERVICE_CATALOG,
        baseUrl,
        documentation: {
            ...SERVICE_CATALOG.documentation,
            interactive: `${baseUrl}/docs`,
            openapi: `${baseUrl}/openapi.json`,
            llms: `${baseUrl}/llms.txt`,
            mcp: `${baseUrl}/mcp/info`,
        },
        _links: {
            self: `${baseUrl}/discovery`,
            docs: `${baseUrl}/docs`,
            openapi: `${baseUrl}/openapi.json`,
            health: `${baseUrl}/health`,
            mcp: `${baseUrl}/mcp`,
        },
    });
}

/**
 * Well-known x402 discovery endpoint (/.well-known/x402)
 * Standard location for x402 service discovery
 */
export function wellKnownX402Handler(c: Context<{ Bindings: Env }>) {
    const baseUrl = new URL(c.req.url).origin;
    
    return c.json({
        x402Version: 1,
        name: "WebLens",
        tagline: "Give your AI agents web superpowers",
        description: "Premium Web Intelligence API with x402 micropayments. Web scraping, research, screenshots, and data extraction for AI agents.",
        baseUrl,
        facilitator: "cdp",
        network: "base",
        token: "USDC",
        bazaarListed: true,
        capabilities: SERVICE_CATALOG.capabilities,
        endpoints: SERVICE_CATALOG.services.map(s => ({
            path: s.endpoint,
            method: s.method,
            name: s.name,
            description: s.description,
            price: s.price,
            tags: s.tags,
            latency: s.latency,
        })),
        pricing: {
            currency: "USDC",
            range: "$0.0005 - $0.08",
            cacheDiscount: "70%",
        },
        documentation: `${baseUrl}/docs`,
        openapi: `${baseUrl}/openapi.json`,
        llms: `${baseUrl}/llms.txt`,
        mcp: `${baseUrl}/mcp`,
        discovery: `${baseUrl}/discovery`,
    });
}
