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
import { registerSystemRoutes } from "./routes/system";
import type { Env, Variables } from "./types";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================
// Global Middleware Chain
// ============================================

// Logging
app.use("*", logger());

// CORS
app.use("*", cors());

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
    "/fetch/basic", "/fetch/pro", "/screenshot", "/search", "/extract",
    "/batch/fetch", "/research", "/extract/smart", "/pdf", "/compare",
    "/monitor/create", "/memory/set",
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

// Export for Cloudflare Workers
export default app;

// Export Durable Objects
export { CreditAccountDO } from "./durable_objects/CreditAccountDO";
export { MonitorScheduler } from "./services/scheduler";
