import type { Hono } from "hono";
import { rateLimitMiddleware } from "../middleware/rate-limit";
import { readerHandler } from "../tools/reader";
import type { Env, Variables } from "../types";

// Tool Handlers

export function registerReaderRoutes(app: Hono<{ Bindings: Env; Variables: Variables }>) {

    // ============================================
    // /r/* — Zero-friction reader (Jina-style)
    // GET /r/https://example.com → markdown content
    // ============================================
    app.use("/r/*", rateLimitMiddleware);
    app.get("/r/*", readerHandler);
}
