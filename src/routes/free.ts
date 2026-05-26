import type { Hono } from "hono";
import { rateLimitMiddleware } from "../middleware/rate-limit";
import { validateRequest } from "../middleware/validation";

// Tool handlers + their canonical free-tier request schemas
import { freeFetch, freeSearch, freeFetchSchema, freeSearchSchema } from "../tools/free";
import type { Env, Variables } from "../types";

export function registerFreeRoutes(app: Hono<{ Bindings: Env; Variables: Variables }>) {

    // ============================================
    // /free/fetch
    // ============================================
    app.use("/free/fetch", rateLimitMiddleware);
    app.use("/free/fetch", validateRequest(freeFetchSchema));
    app.post("/free/fetch", freeFetch);

    // ============================================
    // /free/search
    // ============================================
    app.use("/free/search", rateLimitMiddleware);
    app.use("/free/search", validateRequest(freeSearchSchema));
    app.post("/free/search", freeSearch);
}
