/**
 * Property-Based Tests for Cache Metadata
 * 
 * **Feature: weblens-phase1, Property 7: Cache metadata completeness**
 * **Validates: Requirements 3.6**
 * 
 * For any response from a cache-enabled request, the response SHALL include
 * cache metadata with hit status, and if hit, the age and expiration time.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { CacheManager } from "../../src/services/cache";
import type { CachedResponse } from "../../src/types";

describe("Property 7: Cache metadata completeness", () => {
  /**
   * Property: Cache miss metadata has hit=false
   * For any cache miss, metadata contains hit: false
   */
  it("cache miss metadata has hit=false and key", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        (key) => {
          const cacheManager = new CacheManager(null);
          const metadata = cacheManager.generateMetadata(false, null, key);
          
          expect(metadata.hit).toBe(false);
          expect(metadata.key).toBe(key);
          expect(metadata.age).toBeUndefined();
          expect(metadata.expiresAt).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Cache hit metadata has all required fields
   * For any cache hit, metadata contains hit, age, expiresAt, and key
   */
  it("cache hit metadata has hit=true, age, expiresAt, and key", () => {
    fc.assert(
      fc.property(
        fc.record({
          key: fc.string({ minLength: 1, maxLength: 50 }),
          ttl: fc.integer({ min: 60, max: 86400 }),
          ageSeconds: fc.integer({ min: 0, max: 3600 }),
        }),
        ({ key, ttl, ageSeconds }) => {
          const cacheManager = new CacheManager(null);
          
          // Create a cached response with a timestamp in the past
          const cachedAt = new Date(Date.now() - (ageSeconds * 1000)).toISOString();
          const cached: CachedResponse = {
            data: { test: "data" },
            cachedAt,
            ttl,
          };
          
          const metadata = cacheManager.generateMetadata(true, cached, key);
          
          expect(metadata.hit).toBe(true);
          expect(metadata.key).toBe(key);
          expect(metadata.age).toBeDefined();
          expect(typeof metadata.age).toBe("number");
          expect(metadata.expiresAt).toBeDefined();
          expect(typeof metadata.expiresAt).toBe("string");
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Age is approximately correct
   * For any cached response, age reflects time since caching
   */
  it("age reflects time since caching (within tolerance)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3600 }),
        (ageSeconds) => {
          const cacheManager = new CacheManager(null);
          
          const cachedAt = new Date(Date.now() - (ageSeconds * 1000)).toISOString();
          const cached: CachedResponse = {
            data: {},
            cachedAt,
            ttl: 3600,
          };
          
          const metadata = cacheManager.generateMetadata(true, cached, "test-key");
          
          // Age should be approximately equal to ageSeconds (allow 2 second tolerance for test execution)
          expect(Math.abs(metadata.age! - ageSeconds)).toBeLessThanOrEqual(2);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: expiresAt is cachedAt + TTL
   * For any cached response, expiresAt equals cachedAt plus TTL
   */
  it("expiresAt equals cachedAt plus TTL", () => {
    fc.assert(
      fc.property(
        fc.record({
          ttl: fc.integer({ min: 60, max: 86400 }),
          ageSeconds: fc.integer({ min: 0, max: 1000 }),
        }),
        ({ ttl, ageSeconds }) => {
          const cacheManager = new CacheManager(null);
          
          const cachedAtTime = Date.now() - (ageSeconds * 1000);
          const cachedAt = new Date(cachedAtTime).toISOString();
          const cached: CachedResponse = {
            data: {},
            cachedAt,
            ttl,
          };
          
          const metadata = cacheManager.generateMetadata(true, cached, "test-key");
          
          const expectedExpiresAt = cachedAtTime + (ttl * 1000);
          const actualExpiresAt = new Date(metadata.expiresAt!).getTime();
          
          // Allow 1ms tolerance for rounding
          expect(Math.abs(actualExpiresAt - expectedExpiresAt)).toBeLessThanOrEqual(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Age is non-negative
   * For any cache hit, age is always >= 0
   */
  it("age is always non-negative", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 86400 }),
        (ageSeconds) => {
          const cacheManager = new CacheManager(null);
          
          const cachedAt = new Date(Date.now() - (ageSeconds * 1000)).toISOString();
          const cached: CachedResponse = {
            data: {},
            cachedAt,
            ttl: 3600,
          };
          
          const metadata = cacheManager.generateMetadata(true, cached, "test-key");
          
          expect(metadata.age).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: expiresAt is a valid ISO timestamp
   * For any cache hit, expiresAt is a parseable ISO date string
   */
  it("expiresAt is a valid ISO timestamp", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 60, max: 86400 }),
        (ttl) => {
          const cacheManager = new CacheManager(null);
          
          const cached: CachedResponse = {
            data: {},
            cachedAt: new Date().toISOString(),
            ttl,
          };
          
          const metadata = cacheManager.generateMetadata(true, cached, "test-key");
          
          // Should be parseable as a date
          const parsed = new Date(metadata.expiresAt!);
          expect(parsed.getTime()).not.toBeNaN();
          
          // Should be in ISO format (contains T and Z or timezone)
          expect(metadata.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Key is always present in metadata
   * For any cache operation (hit or miss), key is included
   */
  it("key is always present in metadata", () => {
    fc.assert(
      fc.property(
        fc.record({
          isHit: fc.boolean(),
          key: fc.string({ minLength: 1, maxLength: 100 }),
        }),
        ({ isHit, key }) => {
          const cacheManager = new CacheManager(null);
          
          const cached: CachedResponse | null = isHit
            ? { data: {}, cachedAt: new Date().toISOString(), ttl: 3600 }
            : null;
          
          const metadata = cacheManager.generateMetadata(isHit, cached, key);
          
          expect(metadata.key).toBe(key);
        }
      ),
      { numRuns: 100 }
    );
  });
});
