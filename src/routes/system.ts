import type { Hono } from "hono";
import { SUPPORTED_NETWORKS, PRICING  } from "../config";
import { createCreditMiddleware } from "../middleware/credit-middleware";
import { createLazyPaymentMiddleware } from "../middleware/payment";
import {
    validateRequest,
} from "../middleware/validation";
import { registerOpenAPIRoutes } from "../openapi";

// Tool Handlers
import {
    MonitorCreateRequestSchema,
    MemorySetRequestSchema,
} from "../schemas";
import { dashboardHandler } from "../tools/dashboard";
import { discoveryHandler, wellKnownX402Handler } from "../tools/discovery";
import { health } from "../tools/health";
import { getLandingPageHTML } from "../tools/landing";
import { mcpPostHandler, mcpGetHandler, mcpInfoHandler } from "../tools/mcp";
import { memorySetHandler, memoryGetHandler, memoryDeleteHandler, memoryListHandler } from "../tools/memory";
import { monitorCreateHandler, monitorGetHandler, monitorDeleteHandler } from "../tools/monitor";

import type { Env, Variables } from "../types";

export function registerSystemRoutes(app: Hono<{ Bindings: Env; Variables: Variables }>) {

    // ============================================
    // OpenAPI
    // ============================================
    registerOpenAPIRoutes(app);

    // ============================================
    // Discovery & Metadata
    // ============================================
    app.get("/discovery", discoveryHandler);
    app.get("/.well-known/x402", wellKnownX402Handler);
    app.get("/health", health);
    app.get("/dashboard", dashboardHandler);

    // SEO: robots.txt + sitemap.xml
    app.get("/robots.txt", (c) => {
        const baseUrl = new URL(c.req.url).origin;
        return c.text(`User-agent: *\nAllow: /\nAllow: /docs\nAllow: /r/\nAllow: /s/\nAllow: /llms.txt\nAllow: /openapi.json\nAllow: /discovery\nDisallow: /mcp\nDisallow: /free/\nDisallow: /fetch/\nDisallow: /credits/\n\nSitemap: ${baseUrl}/sitemap.xml\n`);
    });

    app.get("/sitemap.xml", (c) => {
        const baseUrl = new URL(c.req.url).origin;
        const today = new Date().toISOString().split("T")[0];
        const urls = [
            { loc: "/", priority: "1.0", changefreq: "weekly" },
            { loc: "/docs", priority: "0.9", changefreq: "weekly" },
            { loc: "/llms.txt", priority: "0.8", changefreq: "weekly" },
            { loc: "/openapi.json", priority: "0.7", changefreq: "weekly" },
            { loc: "/discovery", priority: "0.8", changefreq: "weekly" },
            { loc: "/.well-known/x402", priority: "0.6", changefreq: "monthly" },
            { loc: "/mcp/info", priority: "0.7", changefreq: "weekly" },
            { loc: "/r/https://example.com", priority: "0.5", changefreq: "monthly" },
            { loc: "/s/web+scraping+api", priority: "0.5", changefreq: "monthly" },
        ];
        const entries = urls.map(u =>
            `  <url>\n    <loc>${baseUrl}${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
        ).join("\n");
        return c.body(
            `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>`,
            200,
            { "Content-Type": "application/xml" }
        );
    });

    // Root — HTML for browsers, JSON for agents/API clients
    app.get("/", (c) => {
        const accept = c.req.header("Accept") ?? "";
        if (accept.includes("text/html")) {
            const baseUrl = new URL(c.req.url).origin;
            return c.html(getLandingPageHTML(baseUrl));
        }

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
                version: 2,
                protocol: "https://x402.org",
                facilitator: "CDP (Coinbase)",
                description: "HTTP-native micropayments using 402 Payment Required",
                bazaarListed: true,
            },
            freeTier: {
                description: "Try WebLens free — no wallet or payment needed",
                reader: {
                    path: "/r/{url}",
                    method: "GET",
                    description: "Zero-friction: just GET /r/ + any URL → markdown",
                    example: "GET /r/https://example.com",
                    limit: "10 requests/hour, 2000 char content limit",
                },
                search: {
                    path: "/s/{query}",
                    method: "GET",
                    description: "Zero-friction: just GET /s/ + query → search results",
                    example: "GET /s/cloudflare+workers",
                    limit: "10 requests/hour, 3 results max",
                },
                endpoints: [
                    { path: "/r/{url}", method: "GET", description: "Zero-friction reader — just append any URL", limit: "10 requests/hour" },
                    { path: "/s/{query}", method: "GET", description: "Zero-friction search — just append a query", limit: "10 requests/hour" },
                    { path: "/free/fetch", method: "POST", description: "Fetch any webpage (truncated to 2000 chars)", limit: "10 requests/hour" },
                    { path: "/free/search", method: "POST", description: "Web search (max 3 results)", limit: "10 requests/hour" },
                ],
                rateLimit: "10 requests/hour per IP (shared across all free endpoints)",
                upgrade: "Use paid endpoints for full content and unlimited access",
            },
        });
    });

    // ============================================
    // MCP Endpoints
    // ============================================
    app.get("/mcp/info", mcpInfoHandler);
    app.get("/mcp", mcpGetHandler);
    app.post("/mcp", mcpPostHandler); // Should be protected?

    // ============================================
    // Monitor Endpoints
    // ============================================
    app.use(
        "/monitor/create",
        createCreditMiddleware(PRICING.monitor.setup, "URL Monitor Setup"),
        validateRequest(MonitorCreateRequestSchema),
        createLazyPaymentMiddleware(
            "/monitor/create",
            PRICING.monitor.setup,
            "Create a URL monitor for change detection.",
            { url: "https://example.com/status", webhookUrl: "https://your-app.com/webhook" },
            {
                properties: {
                    url: { type: "string" },
                    webhookUrl: { type: "string" },
                },
                required: ["url", "webhookUrl"],
            },
            {},
            {}
        )
    );
    app.post("/monitor/create", monitorCreateHandler);

    // Auth required for these
    app.get("/monitor/:id", monitorGetHandler);
    app.delete("/monitor/:id", monitorDeleteHandler);

    // ============================================
    // Memory Endpoints
    // ============================================
    app.use(
        "/memory/set",
        createCreditMiddleware(PRICING.memory.write, "Memory Write"),
        validateRequest(MemorySetRequestSchema),
        createLazyPaymentMiddleware(
            "/memory/set",
            PRICING.memory.write,
            "Store key-value data in Agent Memory.",
            { key: "user_prefs", value: { theme: "dark" } },
            {},
            {},
            {}
        )
    );
    app.post("/memory/set", memorySetHandler);

    // Auth required for these
    app.get("/memory/get", memoryGetHandler); // Should be POST? or query param?
    // Handler expects query param 'key'

    app.delete("/memory/delete", memoryDeleteHandler);
    app.get("/memory/list", memoryListHandler);
}
