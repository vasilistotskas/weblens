/**
 * Response caching middleware.
 *
 * Composition (per cacheable route):
 *   cacheLookupMiddleware(endpoint)  // FIRST — before credit/payment
 *   ...credit → validation → payment...
 *   cacheServeMiddleware()           // LAST  — before the handler
 *
 * Why two middlewares: the cache-hit flag must be known *before* pricing so the
 * credit debit and the x402 402-challenge both reflect the cached discount; but
 * serving the cached body (and storing fresh responses) must happen *after*
 * payment, right before the handler. Both money paths apply the discount via
 * the shared `cacheAwarePrice`.
 */

import type { Context, MiddlewareHandler } from "hono";
import { buildCacheKey, clampCacheTtl, getCached, setCached } from "../services/cache";
import { getCachedPrice } from "../services/pricing";
import type { Env, Variables } from "../types";
import { MAX_BODY_BYTES } from "./validation";

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

interface CacheControlBody {
    cache?: boolean;
    cacheTtl?: number;
    [key: string]: unknown;
}

/**
 * Look up the cache before the money path runs. Keys on the request body minus
 * the cache-control fields (`cache`, `cacheTtl`) so toggling TTL never
 * fragments the cache. Caching is on by default; send `cache: false` to opt out.
 */
export function cacheLookupMiddleware(
    endpoint: string,
): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
    return async (c, next) => {
        // This middleware runs before validateRequest, so the 256KB bound
        // must be enforced here too — otherwise oversized bodies get fully
        // buffered, parsed, and hashed before the validation guard runs.
        const contentLength = Number(c.req.header("Content-Length") ?? "0");
        if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
            return c.json({
                error: "PAYLOAD_TOO_LARGE",
                message: "Request body exceeds the 256KB limit",
                code: "PAYLOAD_TOO_LARGE",
                requestId: c.get("requestId"),
            }, 413);
        }

        const kv = c.env.CACHE;
        if (!kv) {
            await next();
            return;
        }

        let body: CacheControlBody;
        try {
            body = await c.req.json<CacheControlBody>();
        } catch {
            // Not valid JSON — let the validation middleware produce the 400.
            await next();
            return;
        }

        if (body.cache === false) {
            await next();
            return;
        }

        const { cache: _cache, cacheTtl, ...keyParams } = body;
        const key = await buildCacheKey(endpoint, keyParams);
        c.set("cacheEnabled", true);
        c.set("cacheKey", key);
        c.set("cacheTtl", clampCacheTtl(cacheTtl));

        const cached = await getCached(kv, key);
        if (cached !== null && cached !== undefined) {
            c.set("cacheHit", true);
            c.set("cachedBody", cached);
        }

        await next();
    };
}

/**
 * Serve a cached body on hit (skipping the handler) and store fresh 200
 * responses on miss. Must be the last middleware before the route handler.
 */
export function cacheServeMiddleware(): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
    return async (c, next) => {
        if (c.get("cacheHit")) {
            const body = c.get("cachedBody") as Record<string, unknown>;
            c.header("X-Cache", "HIT");
            // Refresh request-scoped fields so the served payload reflects this call.
            return c.json({ ...body, requestId: c.get("requestId"), cached: true });
        }

        await next();

        const kv = c.env.CACHE;
        const key = c.get("cacheKey");
        if (kv && key && c.get("cacheEnabled") && c.res.status === 200) {
            c.res.headers.set("X-Cache", "MISS");
            const ttl = c.get("cacheTtl");
            try {
                const data: unknown = await c.res.clone().json();
                const store = setCached(kv, key, data, ttl);
                try {
                    c.executionCtx.waitUntil(store);
                } catch {
                    // No executionCtx (e.g. in tests) — store inline.
                    await store;
                }
            } catch {
                // Non-JSON body or read error — skip caching, never fail the request.
            }
        }
    };
}

/**
 * Price function that applies the 70% cached discount on a hit. Pass a fixed
 * base price, or a resolver for dynamically-priced endpoints. Used for BOTH
 * the credit debit and the x402 challenge so the two can never diverge —
 * the hit flag is set by `cacheLookupMiddleware`, which runs before either.
 */
export function cacheAwarePrice(
    base: string | ((c: AppContext) => Promise<string>),
): (c: AppContext) => Promise<string> {
    return async (c) => {
        const price = typeof base === "string" ? base : await base(c);
        return c.get("cacheHit") ? getCachedPrice(price) : price;
    };
}
