/**
 * WebLens - Premium Web Intelligence API
 * Main application entry point with x402 payment middleware
 *
 * Requirements: All
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

// Middleware
import { errorHandlerMiddleware } from "./middleware/errorHandler";
import { paymentDebugMiddleware } from "./middleware/payment-debug";
import { requestIdMiddleware } from "./middleware/requestId";
import { securityMiddleware } from "./middleware/security";

// Route Registrars
import { registerAdvancedRoutes } from "./routes/advanced";
import { registerCoreRoutes } from "./routes/core";
import { registerCreditsRoutes } from "./routes/credits";
import { registerFreeRoutes } from "./routes/free";
import { registerIntelRoutes } from "./routes/intel";
import { registerReaderRoutes } from "./routes/reader";
import { registerSystemRoutes } from "./routes/system";
import type { Env, Variables } from "./types";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================
// Global Middleware Chain
// ============================================

// Logging
app.use("*", logger());

// CORS — explicit allow/expose for x402 v2 payment headers.
//
// Browsers do not include `Payment-Signature` in the safelisted CORS request
// headers, so a preflight is required. Without `allowHeaders` containing
// `Payment-Signature` the preflight fails and the actual request never goes
// out — every browser-based x402 client would silently fail.
//
// Likewise, browsers will not let JS read response headers that aren't in
// `Access-Control-Expose-Headers`. Without `PAYMENT-REQUIRED` exposed, a
// browser-based x402 client cannot parse the 402 challenge and cannot sign
// a payment. Without `PAYMENT-RESPONSE` exposed, it cannot read the
// settlement receipt after a successful payment.
app.use("*", cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: [
        "Content-Type",
        "Accept",
        // x402 v2 payment header
        "Payment-Signature",
        // Credit-account auth headers
        "X-CREDIT-WALLET",
        "X-CREDIT-SIGNATURE",
        "X-CREDIT-TIMESTAMP",
    ],
    exposeHeaders: [
        // x402 v2 — required for browser clients to read payment challenge & receipt
        "PAYMENT-REQUIRED",
        "PAYMENT-RESPONSE",
        // WebLens diagnostics
        "X-Request-Id",
        "X-Processing-Time",
        // Credit-account response indicators
        "Payment-Method",
        "Credit-Cost",
    ],
    maxAge: 600,
}));

// Authentication / Payment Debugging
app.use("*", paymentDebugMiddleware);

// Request ID and processing time
app.use("*", requestIdMiddleware);

// Security headers
app.use("*", securityMiddleware);

// Global error handler
app.use("*", errorHandlerMiddleware);


// ============================================
// Global Policies
// ============================================

// POST-only enforcement for paid endpoints
// Must run BEFORE payment middleware to prevent 402 on GET requests
const PAID_ENDPOINTS = [
    "/fetch/basic", "/fetch/pro", "/fetch/resilient", "/screenshot", "/search", "/extract",
    "/batch/fetch", "/research", "/extract/smart", "/pdf", "/compare",
    "/monitor/create", "/memory/set", "/credits/buy",
    "/intel/company", "/intel/market", "/intel/competitive", "/intel/site-audit"
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
            code: "METHOD_NOT_ALLOWED",
            requestId: c.get("requestId"),
        }, 405, {
            "Allow": "POST",
        });
    }

    await next();
});

// ============================================
// Route Registration
// ============================================

// 1. System & Metadata (Health, Docs, Discovery)
registerSystemRoutes(app);

// 1.5 Reader (Zero-friction GET — Jina-style /r/url)
registerReaderRoutes(app);

// 2. Free Tier (Rate-limited)
registerFreeRoutes(app);

// 3. Credits System
registerCreditsRoutes(app);

// 4. Core Tools (Fetch, Screenshot, Search, Extract)
registerCoreRoutes(app);

// 5. Advanced Tools (Batch, Research, PDF, Compare)
registerAdvancedRoutes(app);

// 6. Intelligence Tools (Company, Market, etc.)
registerIntelRoutes(app);

// Custom 404 handler — consistent JSON error envelope
app.notFound((c) => {
    return c.json({
        error: "Not Found",
        code: "NOT_FOUND",
        message: `Route ${c.req.method} ${c.req.path} not found`,
        requestId: c.get("requestId"),
    }, 404);
});

// Named export of the underlying Hono app — used by integration tests that
// want to call `app.request(...)` directly.
export { app };

// Worker entry — x402 v2 only.
export default app;

// Export Durable Objects
export { CreditAccountDO } from "./durable_objects/CreditAccountDO";
export { MonitorScheduler } from "./services/scheduler";
