/**
 * Discovery Endpoint for AI Agents
 * Provides machine-readable service catalog optimized for Bazaar and agent discovery
 */

import type { Context } from "hono";
import { FACILITATOR_URLS, FREE_TIER, pathPublication, absolutePathPublication, SERVICE_NAME, SERVICE_VERSION, supportedNetworks } from "../config";
import { ENDPOINTS } from "../endpoints";
import { describePrice } from "../endpoints/define";
import { facilitatorNames } from "../middleware/payment";
import { getPriceRange } from "../services/pricing";
import type { AppEnv } from "../types";

// Service catalog with rich metadata for AI agent discovery
/**
 * The advertised catalogue. Its services come from the endpoint registry, so
 * an endpoint can no longer be sold without being listed here (the list once
 * fell five endpoints behind when it was maintained by hand).
 */
export const SERVICE_CATALOG = {
    name: SERVICE_NAME,
    version: SERVICE_VERSION,
    tagline: "Give your AI agents web superpowers",
    description: "Premium Web Intelligence API - Give your AI agents web superpowers with x402 micropayments. No API keys, no accounts, just pay per request in USDC.",
    baseUrl: "https://api.weblens.dev",
    protocol: {
        name: "x402",
        version: 2,
        token: "USDC",
        bazaarListed: false,
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
        "Instant settlement - Each payment settles on-chain in seconds",
        "No fees - x402 protocol has 0 platform fees",
        "Discoverable - Listed in the PayAI facilitator discovery catalog",
        "MCP support - Native Model Context Protocol integration",
        "Cache discount - 70% off for cached responses",
        "Free previews - POST /preview returns the price and a real response sample before you pay",
        "ERC-8004 ready - Off-chain registration document, per-call receipts, and hosted feedback documents",
    ],
    capabilities: [
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
        "web-intelligence",
        "free-previews",
        "endpoint-previews",
        "erc-8004",
        "agent-reputation",
        "call-receipts",
    ],
    useCases: [
        "AI agent web browsing and research",
        "Multi-step cited research with source attribution",
        "Automated fact-checking and verification",
        "Content aggregation",
        "Whole-site crawling and knowledge base ingestion",
        "Competitive intelligence gathering",
        "Lead generation and data mining",
        "Visual testing and archiving",
        "Document processing and extraction",
        "Evaluating an endpoint's price and response shape before paying",
        "Citable payment receipts and ERC-8004 feedback for agent reputation",
    ],
    // Products only: billing actions (group "Credits") are listed under
    // integration.paymentMethods instead.
    services: ENDPOINTS.filter((endpoint) => endpoint.group !== "Credits").map((endpoint) => ({
        endpoint: endpoint.path,
        method: "POST",
        name: endpoint.title,
        description: endpoint.description,
        price: describePrice(endpoint),
        tags: endpoint.catalogTags,
        latency: endpoint.latency,
    })),
    pricing: {
        currency: "USDC",
        cacheDiscount: "70% off for cached responses",
        noFees: "x402 protocol has 0 fees",
        instantSettlement: "Seconds, on-chain",
        priceRange: getPriceRange(),
    },
    integration: {
        mcp: {
            remote: "https://api.weblens.dev/mcp",
            description: "Model Context Protocol for AI agents (Claude, Kiro, etc.)",
        },
        http: {
            baseUrl: "https://api.weblens.dev",
            auth: "x402 v2 payment via Payment-Signature header",
        },
        paymentMethods: [
            {
                name: "x402 (on-chain USDC)",
                path: "POST <any paid endpoint>",
                description: "Pay per request with on-chain USDC. No account needed.",
            },
            {
                name: "Credit account (prepaid USDC)",
                path: "POST /credits/buy",
                description: "Deposit USDC once, sign subsequent requests with X-CREDIT-WALLET. 20–40% bonus at $10/$50/$100.",
            },
            {
                name: "Credit account (prepaid via card)",
                path: "POST /credits/deposit/fiat",
                description: "Zero-crypto onboarding. Pay with card via Stripe Checkout; credits land on the wallet address you supply. Minimum $2.",
            },
        ],
    },
    agentQuickStart: {
        step0: "Try it instantly! GET /r/https://example.com — zero friction, no wallet, no POST body needed",
        step1: "Call any paid endpoint (e.g., POST /fetch/basic with {url: 'https://example.com'})",
        step2: "Receive 402 Payment Required — read the PAYMENT-REQUIRED response header (base64-encoded JSON) for amount, asset, payTo, accepts",
        step3: "Sign USDC payment using your wallet (Base network)",
        step4: "Retry with the Payment-Signature header containing the signed payload",
        step5: "Receive data; settlement receipt is in the PAYMENT-RESPONSE response header",
    },
    freeTier: {
        description: "Try WebLens free — no wallet or payment needed",
        endpoints: [
            {
                ...pathPublication("/r/{url}"),
                method: "GET",
                name: "Reader Mode",
                description: "Zero-friction: just GET /r/ + any URL → markdown. No auth, no POST body.",
                price: "FREE",
                rateLimit: `${FREE_TIER.maxRequestsPerHour}/hour`,
                tags: ["free", "reader", "zero-friction", "viral"],
            },
            {
                endpoint: "/free/fetch",
                method: "POST",
                name: "Free Fetch",
                description: `Fetch any webpage (content truncated to ${String(FREE_TIER.fetchMaxContentLength)} chars)`,
                price: "FREE",
                rateLimit: `${FREE_TIER.maxRequestsPerHour}/hour`,
                tags: ["free", "web-scraping", "trial"],
            },
            {
                endpoint: "/preview",
                method: "POST",
                name: "Endpoint Preview",
                description: "See a paid endpoint's live price and a real sample of its response shape before paying. Body: {endpoint, url?}. Endpoints with no paid upstream (/fetch/basic, /contents, /map) also run a real truncated LIVE preview when you pass a url; SerpAPI- and Anthropic-backed endpoints return the recorded sample instead, because free live runs there would burn upstream credits. 404 for an endpoint that is not sold.",
                price: "free",
                rateLimit: `${FREE_TIER.maxRequestsPerHour}/hour`,
                tags: ["free", "free-previews", "endpoint-previews", "evaluation", "pricing"],
            },
            {
                endpoint: "/.well-known/agent-registration.json",
                method: "GET",
                name: "ERC-8004 Registration Document",
                description: "The ERC-8004 registration document (registration-v1): name, description, image, services, x402Support, payment, and feedback endpoints. Off-chain only — WebLens is not registered on-chain, holds no agent id, and writes nothing to any registry, so registrations is empty and supportedTrust is [\"feedback\"].",
                price: "free",
                rateLimit: "none",
                tags: ["free", "erc-8004", "agent-reputation", "identity", "discovery"],
            },
            {
                ...pathPublication("/receipts/{requestId}"),
                method: "GET",
                name: "Call Receipt",
                description: "Receipt for a paid call: endpoint, status, outcome, price, payment method, network, payTo, settlement transaction and payer. Paid responses carry X-Receipt-Id and X-Receipt-Url headers; receipts are kept 30 days. Receipts are unsigned: the settlement transaction is the evidence, checkable on-chain.",
                price: "free",
                rateLimit: "none",
                tags: ["free", "erc-8004", "call-receipts", "payment-evidence"],
            },
            {
                endpoint: "/feedback",
                method: "POST",
                name: "Host ERC-8004 Feedback",
                description: "Host a buyer-authored ERC-8004 feedback document and get back the (feedbackURI, feedbackHash) pair giveFeedback() expects. Required fields: agentRegistry, agentId, clientAddress, createdAt, value, valueDecimals. Stored verbatim — WebLens neither authors nor alters it and never calls the registry.",
                price: "free",
                rateLimit: `${FREE_TIER.maxRequestsPerHour}/hour`,
                tags: ["free", "erc-8004", "agent-reputation", "feedback"],
            },
            {
                ...pathPublication("/feedback/{id}"),
                method: "GET",
                name: "Get Hosted Feedback",
                description: "Serves a hosted feedback document byte-for-byte, so its keccak-256 hash matches the feedbackHash returned when it was stored. This URL is the feedbackURI.",
                price: "free",
                rateLimit: "none",
                tags: ["free", "erc-8004", "agent-reputation", "feedback"],
            },
        ],
        limits: {
            requestsPerHour: FREE_TIER.maxRequestsPerHour,
            fetchContentLength: FREE_TIER.fetchMaxContentLength,
        },
        upgrade: "Use paid endpoints for full content, unlimited access, and premium features",
    },
};

/**
 * Discovery endpoint handler - returns full service catalog
 */
export function discoveryHandler(c: Context<AppEnv>) {
    const baseUrl = new URL(c.req.url).origin;

    // Only advertise the fiat onramp when Stripe is actually configured —
    // otherwise /discovery promises a payment method that `/credits/deposit/fiat`
    // would answer with 503.
    const fiatEnabled = Boolean(c.env.STRIPE_SECRET_KEY);
    const paymentMethods = SERVICE_CATALOG.integration.paymentMethods.filter(
        (m) => fiatEnabled || !m.path.includes("/credits/deposit/fiat")
    );

    const networks = supportedNetworks(c.env);

    return c.json({
        ...SERVICE_CATALOG,
        baseUrl,
        protocol: { ...SERVICE_CATALOG.protocol, networks, facilitator: facilitatorNames(c.env) },
        pricing: { ...SERVICE_CATALOG.pricing, networks },
        documentation: {
            ...SERVICE_CATALOG.documentation,
            interactive: `${baseUrl}/docs`,
            openapi: `${baseUrl}/openapi.json`,
            llms: `${baseUrl}/llms.txt`,
            mcp: `${baseUrl}/mcp/info`,
        },
        integration: {
            ...SERVICE_CATALOG.integration,
            paymentMethods,
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
export function wellKnownX402Handler(c: Context<AppEnv>) {
    const baseUrl = new URL(c.req.url).origin;

    return c.json({
        x402Version: 2,
        name: SERVICE_NAME,
        tagline: "Web access for AI agents, paid per call",
        description: "Web data API for AI agents, paid per call with x402 USDC: fetch and render pages, search, extract structured data, crawl sites, and run cited research.",
        baseUrl,
        facilitator: facilitatorNames(c.env),
        networks: supportedNetworks(c.env),
        token: "USDC",
        bazaarListed: false,
        keywords: [
            "web-scraping", "ai-agent", "x402", "micropayments",
            "web-intelligence", "data-extraction",
            "headless-browser", "research-assistant", "news-search",
            "local-business-data", "youtube-transcripts", "grounded-answers",
            "deep-research", "cited-research",
            "site-mapping", "sitemap-discovery", "web-crawling",
            "free-previews", "erc-8004", "agent-reputation", "call-receipts"
        ],
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
            range: getPriceRange(),
            cacheDiscount: "70%",
        },
        documentation: `${baseUrl}/docs`,
        openapi: `${baseUrl}/openapi.json`,
        llms: `${baseUrl}/llms.txt`,
        mcp: `${baseUrl}/mcp`,
        discovery: `${baseUrl}/discovery`,
        freeTier: {
            description: "Try WebLens free — no wallet needed",
            reader: `${baseUrl}/r/https://example.com`,
            fetch: `${baseUrl}/free/fetch`,
            preview: `${baseUrl}/preview`,
            rateLimit: `${FREE_TIER.maxRequestsPerHour} requests/hour`,
        },
        erc8004: {
            description: "Off-chain ERC-8004 surfaces only. WebLens is not registered on-chain, holds no agent id, and writes nothing to any registry.",
            registration: `${baseUrl}/.well-known/agent-registration.json`,
            receipt: absolutePathPublication(baseUrl, "/receipts/{requestId}"),
            submitFeedback: `${baseUrl}/feedback`,
            feedbackDocument: absolutePathPublication(baseUrl, "/feedback/{id}"),
            hashAlgorithm: "keccak256",
            supportedTrust: ["feedback"],
        },
    });
}

/**
 * Resource-server mirror of the x402 discovery catalogue
 * (GET /v2/x402/discovery/resources, and the /v1 alias).
 *
 * WHY THIS EXISTS. Per the CDP Bazaar spec this path is hosted by
 * FACILITATORS, not by resource servers — but production logs showed ~100
 * requests a week arriving here and getting a 404, from clients that point the
 * facilitator path at the resource server. Answering them turns a dead end
 * into a usable catalogue of all paid endpoints.
 *
 * DELIBERATELY NO `accepts` BLOCK. A facilitator catalogue carries full
 * payment requirements — network, asset address, payTo, amount. Those values
 * are produced by the x402 library from the live network config, not from
 * anything this module can read, so hand-rolling them here would risk
 * publishing a wrong asset or payTo and misdirecting a real payment. Prices
 * come from PRICING (one source of truth) and the authoritative terms stay
 * where they belong: the 402 challenge returned by POSTing the resource.
 */
export function x402ResourceCatalogHandler(c: Context<AppEnv>) {
    const baseUrl = new URL(c.req.url).origin;
    const url = new URL(c.req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "100") || 100, 200);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? "0") || 0, 0);

    const all = SERVICE_CATALOG.services.map((s) => ({
        resource: `${baseUrl}${s.endpoint}`,
        type: "http" as const,
        x402Version: 2,
        method: s.method,
        metadata: {
            name: s.name,
            description: s.description,
            price: s.price,
            tags: s.tags,
        },
    }));

    return c.json({
        // Self-describing: an indexer must not mistake this for a facilitator.
        source: "resource-server-mirror",
        note: "Convenience mirror for clients that request the facilitator discovery path against this origin. Authoritative payment requirements are in the 402 challenge — POST the resource to receive it. The canonical catalogue is hosted by the facilitator.",
        facilitator: c.env.PAYAI_FACILITATOR_URL ?? FACILITATOR_URLS.payai,
        items: all.slice(offset, offset + limit),
        pagination: { limit, offset, total: all.length },
    });
}
