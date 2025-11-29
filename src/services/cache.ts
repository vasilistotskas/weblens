/**
 * Cache Service
 * Manages response caching using Cloudflare KV
 * 
 * Requirements: 3.1, 3.3, 3.4
 */

import { CACHE_CONFIG } from "../config";
import type { CachedResponse, CacheMetadata } from "../types";

/**
 * Generate a SHA256 hash of the input string
 * Uses Web Crypto API available in Cloudflare Workers
 */
async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Sort object keys for consistent hashing
 */
function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj).sort();
  for (const key of keys) {
    const value = obj[key];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      sorted[key] = sortKeys(value as Record<string, unknown>);
    } else {
      sorted[key] = value;
    }
  }
  return sorted;
}

/**
 * Clamp TTL to valid bounds (60-86400 seconds)
 * 
 * @param ttl - The requested TTL in seconds
 * @returns The clamped TTL within valid bounds
 */
export function clampTtl(ttl: number | undefined): number {
  if (ttl === undefined) {
    return CACHE_CONFIG.defaultTtl;
  }
  return Math.max(CACHE_CONFIG.minTtl, Math.min(CACHE_CONFIG.maxTtl, ttl));
}

/**
 * Generate a cache key from endpoint and parameters
 * Format: weblens:{endpoint}:{hash(params)}
 * 
 * @param endpoint - The endpoint name (e.g., "fetch", "screenshot")
 * @param params - The request parameters to hash
 * @returns The cache key string
 */
export async function generateCacheKey(
  endpoint: string, 
  params: Record<string, unknown>
): Promise<string> {
  const sortedParams = sortKeys(params);
  const hash = await sha256(JSON.stringify(sortedParams));
  return `${CACHE_CONFIG.keyPrefix}:${endpoint}:${hash.slice(0, 12)}`;
}

/**
 * Cache Manager class for Cloudflare KV operations
 */
export class CacheManager {
  private kv: KVNamespace | null;

  constructor(kv: KVNamespace | null) {
    this.kv = kv;
  }

  /**
   * Check if cache is available
   */
  isAvailable(): boolean {
    return this.kv !== null;
  }

  /**
   * Get a cached response
   * 
   * @param key - The cache key
   * @returns The cached response or null if not found/expired
   */
  async get<T = unknown>(key: string): Promise<CachedResponse<T> | null> {
    if (!this.kv) {
      return null;
    }

    try {
      const cached = await this.kv.get(key, "json");
      if (!cached) {
        return null;
      }

      const response = cached as CachedResponse<T>;
      
      // Check if expired (KV handles TTL, but double-check)
      const cachedAt = new Date(response.cachedAt).getTime();
      const expiresAt = cachedAt + (response.ttl * 1000);
      
      if (Date.now() > expiresAt) {
        // Expired, delete and return null
        await this.delete(key);
        return null;
      }

      return response;
    } catch {
      // Cache read error, return null (non-fatal)
      return null;
    }
  }

  /**
   * Store a response in cache
   * 
   * @param key - The cache key
   * @param data - The data to cache
   * @param ttl - Time-to-live in seconds (will be clamped to valid bounds)
   */
  async set(key: string, data: unknown, ttl?: number): Promise<void> {
    if (!this.kv) {
      return;
    }

    const clampedTtl = clampTtl(ttl);
    
    const cached: CachedResponse = {
      data,
      cachedAt: new Date().toISOString(),
      ttl: clampedTtl,
    };

    try {
      await this.kv.put(key, JSON.stringify(cached), {
        expirationTtl: clampedTtl,
      });
    } catch {
      // Cache write error, ignore (non-fatal per Requirement 3.7)
    }
  }

  /**
   * Delete a cached response
   * 
   * @param key - The cache key to delete
   */
  async delete(key: string): Promise<void> {
    if (!this.kv) {
      return;
    }

    try {
      await this.kv.delete(key);
    } catch {
      // Ignore delete errors
    }
  }

  /**
   * Generate cache metadata for a response
   * 
   * @param hit - Whether this was a cache hit
   * @param cached - The cached response (if hit)
   * @param key - The cache key
   * @returns Cache metadata object
   */
  generateMetadata(
    hit: boolean, 
    cached: CachedResponse | null, 
    key: string
  ): CacheMetadata {
    if (!hit || !cached) {
      return {
        hit: false,
        key,
      };
    }

    const cachedAt = new Date(cached.cachedAt).getTime();
    const age = Math.floor((Date.now() - cachedAt) / 1000);
    const expiresAt = new Date(cachedAt + (cached.ttl * 1000)).toISOString();

    return {
      hit: true,
      age,
      expiresAt,
      key,
    };
  }
}

/**
 * Create a cache manager instance
 * 
 * @param kv - The Cloudflare KV namespace binding (or null if unavailable)
 * @returns A CacheManager instance
 */
export function createCacheManager(kv: KVNamespace | null): CacheManager {
  return new CacheManager(kv);
}
