/**
 * Response cache service (KV-backed).
 *
 * Cache keys are deterministic: `weblens:{endpoint}:{sha256(params)[:12]}`.
 * Params are serialized with sorted keys so that two semantically-identical
 * request bodies (regardless of property order) map to the same key.
 *
 * The 70% cached-response discount lives in `getCachedPrice()`
 * (src/services/pricing.ts); this module only handles key derivation and the
 * KV get/put with a bounded TTL.
 */

import { CACHE_TTL_SECONDS } from "../config";
import { hashContent } from "./crypto";

/** Deterministic JSON serialization with recursively-sorted object keys. */
function stableStringify(value: unknown): string {
    if (value === undefined) {
        return "null";
    }
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * Build the cache key for an endpoint + request params.
 * @returns `weblens:{endpoint}:{first 12 hex chars of sha256(params)}`
 */
export async function buildCacheKey(endpoint: string, params: unknown): Promise<string> {
    const hash = await hashContent(stableStringify(params));
    return `weblens:${endpoint}:${hash.slice(0, 12)}`;
}

/** Clamp a requested TTL into CACHE_TTL_SECONDS (its default when none was asked for). */
export function clampCacheTtl(ttl: unknown): number {
    if (typeof ttl !== "number" || !Number.isFinite(ttl)) {
        return CACHE_TTL_SECONDS.default;
    }
    return Math.min(CACHE_TTL_SECONDS.max, Math.max(CACHE_TTL_SECONDS.min, Math.floor(ttl)));
}

/** Read a cached JSON value. Returns null on miss or any KV error. */
export async function getCached(kv: KVNamespace, key: string): Promise<unknown> {
    try {
        return await kv.get(key, "json");
    } catch {
        return null;
    }
}

/** Store a JSON value with a bounded TTL. */
export async function setCached(
    kv: KVNamespace,
    key: string,
    value: unknown,
    ttlSeconds: number,
): Promise<void> {
    await kv.put(key, JSON.stringify(value), { expirationTtl: clampCacheTtl(ttlSeconds) });
}
