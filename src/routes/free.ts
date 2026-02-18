import type { Hono } from "hono";
import { rateLimitMiddleware } from "../middleware/rate-limit";
import { validateRequest } from "../middleware/validation";
import { FetchRequestSchema, SearchRequestSchema } from "../schemas";

// Tool Handlers
import { freeFetch, freeSearch } from "../tools/free";
import type { Env, Variables } from "../types";

export function registerFreeRoutes(app: Hono<{ Bindings: Env; Variables: Variables }>) {

    // ============================================
    // /free/fetch
    // ============================================
    app.use("/free/fetch", rateLimitMiddleware);
    app.use("/free/fetch", validateRequest(FetchRequestSchema));
    app.post("/free/fetch", freeFetch);

    // ============================================
    // /free/search
    // ============================================
    app.use("/free/search", rateLimitMiddleware);
    app.use("/free/search", validateRequest(SearchRequestSchema));
    app.post("/free/search", freeSearch);
}
