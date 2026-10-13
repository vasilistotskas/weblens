import type { Hono } from "hono";
import { rateLimitMiddleware } from "../middleware/rate-limit";
import { readerHandler } from "../tools/reader";
import type { AppEnv } from "../types";

export function registerReaderRoutes(app: Hono<AppEnv>) {

    // ============================================
    // /r/* — Zero-friction reader (Jina-style)
    // GET /r/https://example.com → markdown content
    // ============================================
    app.use("/r/*", rateLimitMiddleware);
    app.get("/r/*", readerHandler);
}
