import { describe, it, expect } from "vitest";
import { cacheAwareCreditCost, cacheAwarePaymentPrice } from "../../src/middleware/cache";
import { buildCacheKey, clampCacheTtl, getCached, setCached } from "../../src/services/cache";

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
        ReturnType<typeof cacheAwareCreditCost>
    >[0];
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

describe("cache-aware pricing (70% discount on hit)", () => {
    it("credit cost discounts on hit, base price otherwise", () => {
        expect(cacheAwareCreditCost("$0.005")(ctxWithHit(true))).toBe("$0.0015");
        expect(cacheAwareCreditCost("$0.005")(ctxWithHit(false))).toBe("$0.005");
    });

    it("payment price discounts on hit, base price otherwise", async () => {
        expect(await cacheAwarePaymentPrice("$0.015")(ctxWithHit(true))).toBe("$0.0045");
        expect(await cacheAwarePaymentPrice("$0.015")(ctxWithHit(false))).toBe("$0.015");
    });

    it("payment price resolves and discounts a dynamic base", async () => {
        const dynamic = () => Promise.resolve("$0.0200");
        expect(await cacheAwarePaymentPrice(dynamic)(ctxWithHit(true))).toBe("$0.0060");
        expect(await cacheAwarePaymentPrice(dynamic)(ctxWithHit(false))).toBe("$0.0200");
    });
});
