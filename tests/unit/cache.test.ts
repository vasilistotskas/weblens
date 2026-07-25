import { describe, it, expect, vi } from "vitest";
import { cacheAwarePrice, cacheLookupMiddleware } from "../../src/middleware/cache";
import { buildCacheKey, clampCacheTtl, getCached, setCached } from "../../src/services/cache";
import { MAX_BODY_BYTES } from "../../src/middleware/validation";

// Minimal in-memory KVNamespace stub (only get("json") + put are exercised).
function createMockKV() {
    const store = new Map<string, string>();
    return {
        store,
        get(key: string, type?: string) {
            const v = store.get(key);
            if (v === undefined) { return Promise.resolve(null); }
            return Promise.resolve(type === "json" ? (JSON.parse(v) as unknown) : v);
        },
        put(key: string, value: string) {
            store.set(key, value);
            return Promise.resolve();
        },
    } as unknown as KVNamespace;
}

// Minimal Hono context stub exposing only c.get("cacheHit").
function ctxWithHit(hit: boolean) {
    return { get: (k: string) => (k === "cacheHit" ? hit : undefined) } as unknown as Parameters<
        ReturnType<typeof cacheAwarePrice>
    >[0];
}

// Minimal Hono context stub for cacheLookupMiddleware: request headers,
// requestId, env bindings, and a c.json that captures {body, status}.
function ctxForLookup(options: { contentLength?: string; env?: Record<string, unknown> }) {
    const vars = new Map<string, unknown>([["requestId", "wl_test_abc123"]]);
    return {
        req: {
            header: (name: string) =>
                name === "Content-Length" ? options.contentLength : undefined,
            json: () => Promise.resolve({}),
        },
        env: options.env ?? {},
        get: (k: string) => vars.get(k),
        set: (k: string, v: unknown) => { vars.set(k, v); },
        json: (body: unknown, status?: number) => ({ body, status }),
    } as unknown as Parameters<ReturnType<typeof cacheLookupMiddleware>>[0];
}

describe("buildCacheKey", () => {
    it("is deterministic for identical params", async () => {
        const a = await buildCacheKey("fetch-basic", { url: "https://x.com", timeout: 10000 });
        const b = await buildCacheKey("fetch-basic", { url: "https://x.com", timeout: 10000 });
        expect(a).toBe(b);
    });

    it("is independent of property order", async () => {
        const a = await buildCacheKey("fetch-basic", { url: "https://x.com", timeout: 10000 });
        const b = await buildCacheKey("fetch-basic", { timeout: 10000, url: "https://x.com" });
        expect(a).toBe(b);
    });

    it("differs for different params or endpoints", async () => {
        const base = await buildCacheKey("fetch-basic", { url: "https://x.com" });
        expect(await buildCacheKey("fetch-basic", { url: "https://y.com" })).not.toBe(base);
        expect(await buildCacheKey("fetch-pro", { url: "https://x.com" })).not.toBe(base);
    });

    it("matches the documented weblens:{endpoint}:{12hex} format", async () => {
        const key = await buildCacheKey("fetch-basic", { url: "https://x.com" });
        expect(key).toMatch(/^weblens:fetch-basic:[0-9a-f]{12}$/u);
    });
});

describe("clampCacheTtl", () => {
    it("clamps below the floor to 60", () => { expect(clampCacheTtl(1)).toBe(60); });
    it("clamps above the ceiling to 86400", () => { expect(clampCacheTtl(999999)).toBe(86400); });
    it("floors in-range values", () => { expect(clampCacheTtl(3600.9)).toBe(3600); });
    it("defaults non-numbers to 3600", () => {
        expect(clampCacheTtl(undefined)).toBe(3600);
        expect(clampCacheTtl("nope")).toBe(3600);
        expect(clampCacheTtl(Number.NaN)).toBe(3600);
    });
});

describe("KV get/set round-trip", () => {
    it("stores and reads back a JSON value", async () => {
        const kv = createMockKV();
        await setCached(kv, "weblens:fetch-basic:abc123abc123", { title: "Hi" }, 3600);
        expect(await getCached(kv, "weblens:fetch-basic:abc123abc123")).toEqual({ title: "Hi" });
    });

    it("returns null on a miss", async () => {
        const kv = createMockKV();
        expect(await getCached(kv, "missing")).toBeNull();
    });
});

describe("cacheAwarePrice (70% discount on hit)", () => {
    it("discounts a fixed base price on hit, base price otherwise", async () => {
        expect(await cacheAwarePrice("$0.005")(ctxWithHit(true))).toBe("$0.0015");
        expect(await cacheAwarePrice("$0.005")(ctxWithHit(false))).toBe("$0.005");
    });

    it("discounts a higher fixed base price on hit, base price otherwise", async () => {
        expect(await cacheAwarePrice("$0.015")(ctxWithHit(true))).toBe("$0.0045");
        expect(await cacheAwarePrice("$0.015")(ctxWithHit(false))).toBe("$0.015");
    });

    it("resolves and discounts a dynamic base", async () => {
        const dynamic = () => Promise.resolve("$0.0200");
        expect(await cacheAwarePrice(dynamic)(ctxWithHit(true))).toBe("$0.0060");
        expect(await cacheAwarePrice(dynamic)(ctxWithHit(false))).toBe("$0.0200");
    });
});

describe("cacheLookupMiddleware body-size guard", () => {
    it("returns 413 PAYLOAD_TOO_LARGE when Content-Length exceeds 256KB and does not call next", async () => {
        const c = ctxForLookup({ contentLength: String(MAX_BODY_BYTES + 1) });
        const next = vi.fn(() => Promise.resolve());

        const result = (await cacheLookupMiddleware("fetch-basic")(c, next)) as unknown as {
            body: { error: string; code: string; message: string; requestId: string };
            status: number;
        };

        expect(result.status).toBe(413);
        expect(result.body.code).toBe("PAYLOAD_TOO_LARGE");
        expect(result.body.error).toBe("PAYLOAD_TOO_LARGE");
        expect(result.body.requestId).toBe("wl_test_abc123");
        expect(next).not.toHaveBeenCalled();
    });

    it("passes through (calls next) for small bodies", async () => {
        const c = ctxForLookup({ contentLength: "128" });
        const next = vi.fn(() => Promise.resolve());

        await cacheLookupMiddleware("fetch-basic")(c, next);

        expect(next).toHaveBeenCalledTimes(1);
    });

    it("passes through when Content-Length is exactly the limit", async () => {
        const c = ctxForLookup({ contentLength: String(MAX_BODY_BYTES) });
        const next = vi.fn(() => Promise.resolve());

        await cacheLookupMiddleware("fetch-basic")(c, next);

        expect(next).toHaveBeenCalledTimes(1);
    });
});
