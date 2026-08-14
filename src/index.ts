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
import { errorHandler } from "./middleware/errorHandler";
import { paymentDebugMiddleware } from "./middleware/payment-debug";
import { receiptMiddleware } from "./middleware/receipt";
import { requestIdMiddleware } from "./middleware/requestId";
import { paidEndpointsArePostOnly, pathTemplateMiddleware, routeMethodGuard } from "./middleware/routing";
import { securityMiddleware } from "./middleware/security";

// Route Registrars
import { registerAdvancedRoutes } from "./routes/advanced";
import { registerCoreRoutes } from "./routes/core";
import { registerCreditsRoutes } from "./routes/credits";
import { registerFreeRoutes } from "./routes/free";
import { registerIntelRoutes } from "./routes/intel";
import { registerReaderRoutes } from "./routes/reader";
import { registerSystemRoutes } from "./routes/system";
import { registerVerticalRoutes } from "./routes/verticals";
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

// ERC-8004 receipts for paid calls (no-op for everything else)
app.use("*", receiptMiddleware());


// ============================================
// Global Policies
// ============================================

// Paid endpoints are POST-only. Must run BEFORE the payment middleware, which
// is registered per-path with app.use() and so would answer a GET with a 402.
app.use("*", paidEndpointsArePostOnly);

// A documented path still carrying its {placeholder} gets the concrete URL to
// call. Ahead of the routers so it also pre-empts the free-tier rate limiter.
app.use("*", pathTemplateMiddleware);

// 405 + Allow for any path registered under a different method, derived from
// the app's own route table. Wraps the routes below and rewrites their 404s.
app.use("*", routeMethodGuard(app));

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

// 4.5 Search Verticals, Social, Contents, Answer
registerVerticalRoutes(app);

// 5. Advanced Tools (Batch, Research, PDF, Compare)
registerAdvancedRoutes(app);

// 6. Intelligence Tools (Company, Market, etc.)
registerIntelRoutes(app);

// Custom 404 handler — consistent JSON error envelope
app.notFound((c) => {
    return c.json({
        error: "NOT_FOUND",
        code: "NOT_FOUND",
        message: `Route ${c.req.method} ${c.req.path} not found`,
        requestId: c.get("requestId"),
    }, 404);
});

// Global error handler (idiomatic Hono): catches throws from any middleware or
// handler regardless of order, returning the consistent error envelope.
app.onError(errorHandler);

// Named export of the underlying Hono app — used by integration tests that
// want to call `app.request(...)` directly.
export { app };

// Worker entry — x402 v2 only.
export default app;

// Export Durable Objects
export { CreditAccountDO } from "./durable_objects/CreditAccountDO";
export { MonitorScheduler } from "./services/scheduler";
