import type { Hono } from "hono";
import { PRICING } from "../config";
import { createCreditMiddleware } from "../middleware/credit-middleware";
import { createLazyPaymentMiddleware } from "../middleware/payment";
import { validateRequest } from "../middleware/validation";
import { IntelRequestSchema } from "../schemas";

// Tool Handlers
import {
    intelCompanyHandler,
    intelMarketHandler,
    intelCompetitiveHandler,
    intelSiteAuditHandler
} from "../tools/intel";
import type { Env, Variables } from "../types";

// Reusable Bazaar input schema — all four intel endpoints accept the same
// `{ param, depth }` request body shape (see IntelRequestSchema in schemas.ts).
const INTEL_INPUT_SCHEMA = {
    type: "object",
    properties: {
        param: { type: "string", description: "Symbol, domain, or query depending on the endpoint" },
        depth: {
            type: "string",
            enum: ["basic", "deep"],
            description: "Depth of analysis (default: basic)",
        },
    },
    required: ["param"],
} as const;

export function registerIntelRoutes(app: Hono<{ Bindings: Env; Variables: Variables }>) {
    // ============================================
    // /intel/company — Company deep dive
    // ============================================
    app.use(
        "/intel/company",
        createCreditMiddleware(PRICING.intel.company, "Company Intelligence"),
        validateRequest(IntelRequestSchema),
        createLazyPaymentMiddleware(
            "/intel/company",
            PRICING.intel.company,
            "Get comprehensive intelligence on any company. Includes verified data, funding, key people, and recent news.",
            { param: "coinbase", depth: "basic" },
            INTEL_INPUT_SCHEMA,
            {
                name: "Coinbase",
                domain: "coinbase.com",
                funding: "Public (COIN)",
                summary: "Coinbase is a secure online platform for buying, selling, and storing crypto.",
                requestId: "req_intel123",
            },
            {
                type: "object",
                properties: {
                    name: { type: "string" },
                    domain: { type: "string" },
                    funding: { type: "string" },
                    summary: { type: "string" },
                    requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/intel/company", intelCompanyHandler);

    // ============================================
    // /intel/market — Market research report
    // ============================================
    app.use(
        "/intel/market",
        createCreditMiddleware(PRICING.intel.market, "Market Intelligence"),
        validateRequest(IntelRequestSchema),
        createLazyPaymentMiddleware(
            "/intel/market",
            PRICING.intel.market,
            "Analyze market trends and dynamics. Get market size, growth rates, key trends, players, and recommended actions.",
            { param: "AI Agents", depth: "basic" },
            INTEL_INPUT_SCHEMA,
            {
                topic: "AI Agents",
                executiveSummary: "The AI agents market is rapidly expanding...",
                marketSize: "$10B (2026)",
                growthRate: "45% CAGR",
                keyTrends: ["autonomous tooling", "x402 micropayments", "MCP standardization"],
                keyPlayers: ["Anthropic", "OpenAI", "Coinbase Agentkit"],
                recommendations: ["Invest in agent infrastructure", "Adopt open standards"],
                requestId: "req_market123",
            },
            {
                type: "object",
                properties: {
                    topic: { type: "string" },
                    executiveSummary: { type: "string" },
                    marketSize: { type: "string" },
                    growthRate: { type: "string" },
                    keyTrends: { type: "array", items: { type: "string" } },
                    keyPlayers: { type: "array", items: { type: "string" } },
                    recommendations: { type: "array", items: { type: "string" } },
                    requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/intel/market", intelMarketHandler);

    // ============================================
    // /intel/competitive — Competitive analysis
    // ============================================
    app.use(
        "/intel/competitive",
        createCreditMiddleware(PRICING.intel.competitive, "Competitive Intelligence"),
        validateRequest(IntelRequestSchema),
        createLazyPaymentMiddleware(
            "/intel/competitive",
            PRICING.intel.competitive,
            "Analyze competitors and their positioning. Compare features, pricing, SWOT, and market share.",
            { param: "Example Corp", depth: "basic" },
            INTEL_INPUT_SCHEMA,
            {
                company: "Example Corp",
                competitors: ["Acme Inc", "Globex", "Initech"],
                featureMatrix: {
                    "Example Corp": ["Feature A", "Feature B"],
                    "Acme Inc": ["Feature A"],
                },
                pricing: { "Example Corp": "$99/mo", "Acme Inc": "$79/mo" },
                swot: {
                    strengths: ["Brand"],
                    weaknesses: ["Pricing"],
                    opportunities: ["AI integration"],
                    threats: ["Open source alternatives"],
                },
                positioning: "Example Corp leads in enterprise but lags on developer experience.",
                requestId: "req_compet123",
            },
            {
                type: "object",
                properties: {
                    company: { type: "string" },
                    competitors: { type: "array", items: { type: "string" } },
                    featureMatrix: { type: "object" },
                    pricing: { type: "object" },
                    swot: {
                        type: "object",
                        properties: {
                            strengths: { type: "array", items: { type: "string" } },
                            weaknesses: { type: "array", items: { type: "string" } },
                            opportunities: { type: "array", items: { type: "string" } },
                            threats: { type: "array", items: { type: "string" } },
                        },
                    },
                    positioning: { type: "string" },
                    requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/intel/competitive", intelCompetitiveHandler);

    // ============================================
    // /intel/site-audit — Full site audit (SEO, performance, security)
    // ============================================
    app.use(
        "/intel/site-audit",
        createCreditMiddleware(PRICING.intel.siteAudit, "Site Audit"),
        validateRequest(IntelRequestSchema),
        createLazyPaymentMiddleware(
            "/intel/site-audit",
            PRICING.intel.siteAudit,
            "Audit a website for SEO, performance, and security with actionable recommendations and scoring.",
            { param: "https://example.com", depth: "basic" },
            INTEL_INPUT_SCHEMA,
            {
                url: "https://example.com",
                scores: { seo: 87, performance: 92, security: 95, accessibility: 88 },
                issues: [
                    { severity: "high", category: "seo", message: "Missing meta description" },
                    { severity: "low", category: "performance", message: "Render-blocking CSS" },
                ],
                recommendations: [
                    "Add unique meta descriptions to every page",
                    "Defer non-critical CSS",
                ],
                auditedAt: "2026-04-06T12:00:00.000Z",
                requestId: "req_audit123",
            },
            {
                type: "object",
                properties: {
                    url: { type: "string" },
                    scores: {
                        type: "object",
                        properties: {
                            seo: { type: "number" },
                            performance: { type: "number" },
                            security: { type: "number" },
                            accessibility: { type: "number" },
                        },
                    },
                    issues: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                severity: { type: "string" },
                                category: { type: "string" },
                                message: { type: "string" },
                            },
                        },
                    },
                    recommendations: { type: "array", items: { type: "string" } },
                    auditedAt: { type: "string" },
                    requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/intel/site-audit", intelSiteAuditHandler);
}
