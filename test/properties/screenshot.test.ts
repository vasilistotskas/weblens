/**
 * Property-Based Tests for Screenshot Endpoint
 * 
 * **Feature: weblens-phase1, Property 1: Screenshot returns valid PNG data**
 * **Validates: Requirements 1.1, 1.6**
 * 
 * For any valid URL request to `/screenshot`, the response SHALL contain
 * base64-encoded data that decodes to valid PNG format with dimensions
 * matching the requested or default viewport.
 * 
 * Note: Since we can't call Browser Rendering in tests, we test the
 * validation logic and response structure properties.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { normalizeViewport, normalizeTimeout } from "../../src/services/screenshot";
import { VIEWPORT_BOUNDS, TIMEOUT_CONFIG } from "../../src/config";

describe("Property 1: Screenshot returns valid PNG data (validation properties)", () => {
  /**
   * Property: Viewport normalization always returns valid dimensions
   * For any input viewport, the result is always within valid bounds
   */
  it("viewport normalization always returns dimensions within valid bounds", () => {
    fc.assert(
      fc.property(
        fc.record({
          width: fc.integer({ min: -1000, max: 10000 }),
          height: fc.integer({ min: -1000, max: 10000 }),
        }),
        (viewport) => {
          const result = normalizeViewport(viewport);
          
          expect(result.width).toBeGreaterThanOrEqual(VIEWPORT_BOUNDS.width.min);
          expect(result.width).toBeLessThanOrEqual(VIEWPORT_BOUNDS.width.max);
          expect(result.height).toBeGreaterThanOrEqual(VIEWPORT_BOUNDS.height.min);
          expect(result.height).toBeLessThanOrEqual(VIEWPORT_BOUNDS.height.max);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Undefined viewport returns defaults
   * When no viewport is provided, default dimensions are used
   */
  it("undefined viewport returns default dimensions", () => {
    fc.assert(
      fc.property(
        fc.constant(undefined),
        () => {
          const result = normalizeViewport(undefined);
          
          expect(result.width).toBe(VIEWPORT_BOUNDS.width.default);
          expect(result.height).toBe(VIEWPORT_BOUNDS.height.default);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Valid viewport dimensions are preserved
   * For any viewport within bounds, the values are preserved
   */
  it("valid viewport dimensions within bounds are preserved", () => {
    fc.assert(
      fc.property(
        fc.record({
          width: fc.integer({ min: VIEWPORT_BOUNDS.width.min, max: VIEWPORT_BOUNDS.width.max }),
          height: fc.integer({ min: VIEWPORT_BOUNDS.height.min, max: VIEWPORT_BOUNDS.height.max }),
        }),
        (viewport) => {
          const result = normalizeViewport(viewport);
          
          expect(result.width).toBe(viewport.width);
          expect(result.height).toBe(viewport.height);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Timeout normalization always returns valid timeout
   * For any input timeout, the result is always within valid bounds
   */
  it("timeout normalization always returns value within valid bounds", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10000, max: 100000 }),
        (timeout) => {
          const result = normalizeTimeout(timeout);
          
          expect(result).toBeGreaterThanOrEqual(TIMEOUT_CONFIG.min);
          expect(result).toBeLessThanOrEqual(TIMEOUT_CONFIG.max);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Undefined timeout returns default
   * When no timeout is provided, default timeout is used
   */
  it("undefined timeout returns default value", () => {
    fc.assert(
      fc.property(
        fc.constant(undefined),
        () => {
          const result = normalizeTimeout(undefined);
          expect(result).toBe(TIMEOUT_CONFIG.default);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Valid timeout values are preserved
   * For any timeout within bounds, the value is preserved
   */
  it("valid timeout values within bounds are preserved", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: TIMEOUT_CONFIG.min, max: TIMEOUT_CONFIG.max }),
        (timeout) => {
          const result = normalizeTimeout(timeout);
          expect(result).toBe(timeout);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Normalization is idempotent
   * Applying normalization twice gives the same result as once
   */
  it("viewport normalization is idempotent", () => {
    fc.assert(
      fc.property(
        fc.record({
          width: fc.integer({ min: -1000, max: 10000 }),
          height: fc.integer({ min: -1000, max: 10000 }),
        }),
        (viewport) => {
          const once = normalizeViewport(viewport);
          const twice = normalizeViewport(once);
          
          expect(twice.width).toBe(once.width);
          expect(twice.height).toBe(once.height);
        }
      ),
      { numRuns: 100 }
    );
  });
});
