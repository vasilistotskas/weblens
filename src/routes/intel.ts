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

export function registerIntelRoutes(app: Hono<{ Bindings: Env; Variables: Variables }>) {

    // ============================================
    // /intel/company
    // ============================================
    app.use(
        "/intel/company",
        createCreditMiddleware(PRICING.research, "Company Intelligence"),
        validateRequest(IntelRequestSchema),
        createLazyPaymentMiddleware(
            "/intel/company",
            PRICING.research,
            "Get comprehensive intelligence on any company. Includes verified data, funding, key people, and recent news.",
            { param: "coinbase", depth: "basic" },
            {
                properties: {
                    param: { type: "string", description: "Company name or domain" },
                    depth: { type: "string", description: "Depth of analysis (basic or deep)" },
                },
                required: ["param"],
            },
            {
                name: "Coinbase",
                domain: "coinbase.com",
                funding: "Public (COIN)",
                summary: "Coinbase is a secure online platform...",
                requestId: "req_intel123",
            },
            {
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
    // /intel/market
    // ============================================
    app.use(
        "/intel/market",
        createCreditMiddleware(PRICING.research, "Market Intelligence"),
        validateRequest(IntelRequestSchema),
        createLazyPaymentMiddleware(
            "/intel/market",
            PRICING.research,
            "Analyze market trends and dynamics. Get market size, growth rates, and key trends.",
            { param: "AI Agents", depth: "basic" },
            {},
            {},
            {}
        )
    );
    app.post("/intel/market", intelMarketHandler);

    // ============================================
    // /intel/competitive
    // ============================================
    app.use(
        "/intel/competitive",
        createCreditMiddleware(PRICING.research, "Competitive Intelligence"),
        validateRequest(IntelRequestSchema),
        createLazyPaymentMiddleware(
            "/intel/competitive",
            PRICING.research,
            "Analyze competitors and their positioning. Compare features, pricing, and market share.",
            { param: "Example Corp", depth: "basic" },
            {},
            {},
            {}
        )
    );
    app.post("/intel/competitive", intelCompetitiveHandler);

    // ============================================
    // /intel/site-audit
    // ============================================
    app.use(
        "/intel/site-audit",
        createCreditMiddleware(PRICING.research, "Site Audit"),
        validateRequest(IntelRequestSchema),
        createLazyPaymentMiddleware(
            "/intel/site-audit",
            PRICING.research,
            "Audit a website for technical health, SEO, and performance.",
            { param: "https://example.com", depth: "basic" },
            {},
            {},
            {}
        )
    );
    app.post("/intel/site-audit", intelSiteAuditHandler);
}
