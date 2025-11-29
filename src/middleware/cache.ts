/**
 * Cache Middleware
 * Handles cache checking and storage for cache-enabled endpoints
 * 
 * Requirements: 3.1, 3.3, 3.6
 */

import type { Context, Next } from "hono";
import { CacheManager, generateCacheKey, clampTtl } from "../services/cache";
import type { Env, CacheMetadata } from "../types";

// Extend Hono context to include cache-related data
declare module "hono" {
  interface ContextVariableMap {
    cacheManager: CacheManager;
    cacheKey: string;
    cacheHit: boolean;
    cachedData: unknown;
    cacheMetadata: CacheMetadata;
    cacheTtl: number;
  }
}

/**
 * Cache middleware factory
 * Creates middleware that checks cache before processing and stores after success
 * 
 * @param endpoint - The endpoint name for cache key generation
 * @returns Hono middleware function
 */
export function cacheMiddleware(endpoint: string) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    // Get cache parameter from query string
    const cacheEnabled = c.req.query("cache") === "true";
    
    // Get TTL from query string (will be clamped in cache service)
    const requestedTtl = c.req.query("cacheTtl");
    const ttl = requestedTtl ? clampTtl(parseInt(requestedTtl, 10)) : clampTtl(undefined);
    
    // Create cache manager
    const kv = c.env.CACHE ?? null;
    const cacheManager = new CacheManager(kv);
    
    // Store cache manager and TTL in context for later use
    c.set("cacheManager", cacheManager);
    c.set("cacheTtl", ttl);
    
    // If caching is not enabled, skip cache check
    if (!cacheEnabled) {
      c.set("cacheHit", false);
      c.set("cacheMetadata", { hit: false });
      await next();
      return;
    }

    // Try to get request body for cache key generation
    let body: Record<string, unknown> = {};
    try {
      const clonedRequest = c.req.raw.clone();
      body = await clonedRequest.json();
    } catch {
      // No body or invalid JSON, use empty object
    }

    // Generate cache key
    const cacheKey = await generateCacheKey(endpoint, {
      ...body,
      query: Object.fromEntries(new URL(c.req.url).searchParams),
    });
    c.set("cacheKey", cacheKey);

    // Check cache
    const cached = await cacheManager.get(cacheKey);
    
    if (cached) {
      // Cache hit - store data and metadata
      c.set("cacheHit", true);
      c.set("cachedData", cached.data);
      c.set("cacheMetadata", cacheManager.generateMetadata(true, cached, cacheKey));
      
      // Return cached response directly
      // The endpoint handler should check for cacheHit and return cachedData
    } else {
      // Cache miss
      c.set("cacheHit", false);
      c.set("cacheMetadata", cacheManager.generateMetadata(false, null, cacheKey));
    }

    await next();
  };
}

/**
 * Store response in cache after successful processing
 * Call this from endpoint handlers after generating a response
 * 
 * @param c - Hono context
 * @param data - The response data to cache
 */
export async function storeInCache(c: Context, data: unknown): Promise<void> {
  const cacheManager = c.get("cacheManager") as CacheManager | undefined;
  const cacheKey = c.get("cacheKey") as string | undefined;
  const ttl = c.get("cacheTtl") as number | undefined;
  const cacheHit = c.get("cacheHit") as boolean | undefined;

  // Only store if cache is enabled and this wasn't a cache hit
  if (cacheManager && cacheKey && !cacheHit) {
    await cacheManager.set(cacheKey, data, ttl);
  }
}

/**
 * Get cached data if available
 * 
 * @param c - Hono context
 * @returns The cached data or null
 */
export function getCachedData(c: Context): unknown {
  const cacheHit = c.get("cacheHit") as boolean | undefined;
  if (cacheHit) {
    return c.get("cachedData");
  }
  return null;
}

/**
 * Check if this request was a cache hit
 * 
 * @param c - Hono context
 * @returns true if cache hit, false otherwise
 */
export function isCacheHit(c: Context): boolean {
  const hit = c.get("cacheHit") as boolean | undefined;
  return hit === true;
}

/**
 * Get cache metadata for response
 * 
 * @param c - Hono context
 * @returns Cache metadata object
 */
export function getCacheMetadata(c: Context): CacheMetadata {
  return (c.get("cacheMetadata") as CacheMetadata | undefined) ?? { hit: false };
}
