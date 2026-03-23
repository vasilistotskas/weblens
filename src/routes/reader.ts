import type { Hono } from "hono";
import { rateLimitMiddleware } from "../middleware/rate-limit";
import { readerHandler } from "../tools/reader";
import { searchReaderHandler } from "../tools/search-reader";
import type { Env, Variables } from "../types";

export function registerReaderRoutes(app: Hono<{ Bindings: Env; Variables: Variables }>) {

    // ============================================
    // /r/* — Zero-friction reader (Jina-style)
    // GET /r/https://example.com → markdown content
    // ============================================
    app.use("/r/*", rateLimitMiddleware);
    app.get("/r/*", readerHandler);

    // ============================================
    // /s/* — Zero-friction search
    // GET /s/cloudflare+workers → search results
    // ============================================
    app.use("/s/*", rateLimitMiddleware);
    app.get("/s/*", searchReaderHandler);
}
