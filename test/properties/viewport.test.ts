/**
 * Property-Based Tests for Viewport Dimensions
 * 
 * **Feature: weblens-phase1, Property 2: Viewport dimensions are respected**
 * **Validates: Requirements 1.2**
 * 
 * For any screenshot request with viewport dimensions within valid ranges
 * (320-3840 width, 240-2160 height), the captured image dimensions SHALL
 * match the specified viewport dimensions.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { normalizeViewport } from "../../src/services/screenshot";
import { VIEWPORT_BOUNDS } from "../../src/config";

describe("Property 2: Viewport dimensions are respected", () => {
  /**
   * Property: Valid viewport dimensions are preserved exactly
   * For any viewport within valid ranges, dimensions are not modified
   */
  it("valid viewport dimensions (320-3840 width, 240-2160 height) are preserved exactly", () => {
    fc.assert(
      fc.property(
        fc.record({
          width: fc.integer({ min: VIEWPORT_BOUNDS.width.min, max: VIEWPORT_BOUNDS.width.max }),
          height: fc.integer({ min: VIEWPORT_BOUNDS.height.min, max: VIEWPORT_BOUNDS.height.max }),
        }),
        (viewport) => {
          const result = normalizeViewport(viewport);
          
          // Dimensions should be preserved exactly
          expect(result.width).toBe(viewport.width);
          expect(result.height).toBe(viewport.height);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Width below minimum (but positive) is clamped to 320
   * For any positive width < 320, the result is 320
   */
  it("positive width below minimum (320) is clamped to 320", () => {
    fc.assert(
      fc.property(
        fc.record({
          width: fc.integer({ min: 1, max: VIEWPORT_BOUNDS.width.min - 1 }),
          height: fc.integer({ min: VIEWPORT_BOUNDS.height.min, max: VIEWPORT_BOUNDS.height.max }),
        }),
        (viewport) => {
          const result = normalizeViewport(viewport);
          expect(result.width).toBe(VIEWPORT_BOUNDS.width.min);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Width above maximum is clamped to 3840
   * For any width > 3840, the result is 3840
   */
  it("width above maximum (3840) is clamped to 3840", () => {
    fc.assert(
      fc.property(
        fc.record({
          width: fc.integer({ min: VIEWPORT_BOUNDS.width.max + 1, max: 10000 }),
          height: fc.integer({ min: VIEWPORT_BOUNDS.height.min, max: VIEWPORT_BOUNDS.height.max }),
        }),
        (viewport) => {
          const result = normalizeViewport(viewport);
          expect(result.width).toBe(VIEWPORT_BOUNDS.width.max);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Height below minimum (but positive) is clamped to 240
   * For any positive height < 240, the result is 240
   */
  it("positive height below minimum (240) is clamped to 240", () => {
    fc.assert(
      fc.property(
        fc.record({
          width: fc.integer({ min: VIEWPORT_BOUNDS.width.min, max: VIEWPORT_BOUNDS.width.max }),
          height: fc.integer({ min: 1, max: VIEWPORT_BOUNDS.height.min - 1 }),
        }),
        (viewport) => {
          const result = normalizeViewport(viewport);
          expect(result.height).toBe(VIEWPORT_BOUNDS.height.min);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Height above maximum is clamped to 2160
   * For any height > 2160, the result is 2160
   */
  it("height above maximum (2160) is clamped to 2160", () => {
    fc.assert(
      fc.property(
        fc.record({
          width: fc.integer({ min: VIEWPORT_BOUNDS.width.min, max: VIEWPORT_BOUNDS.width.max }),
          height: fc.integer({ min: VIEWPORT_BOUNDS.height.max + 1, max: 10000 }),
        }),
        (viewport) => {
          const result = normalizeViewport(viewport);
          expect(result.height).toBe(VIEWPORT_BOUNDS.height.max);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Boundary values are handled correctly
   * Exact boundary values (320, 3840, 240, 2160) are preserved
   */
  it("boundary values are preserved exactly", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          { width: VIEWPORT_BOUNDS.width.min, height: VIEWPORT_BOUNDS.height.min },
          { width: VIEWPORT_BOUNDS.width.max, height: VIEWPORT_BOUNDS.height.max },
          { width: VIEWPORT_BOUNDS.width.min, height: VIEWPORT_BOUNDS.height.max },
          { width: VIEWPORT_BOUNDS.width.max, height: VIEWPORT_BOUNDS.height.min }
        ),
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
   * Property: Default viewport matches configuration
   * When no viewport is provided, defaults are used
   */
  it("default viewport matches configuration (1280x720)", () => {
    fc.assert(
      fc.property(
        fc.constant(undefined),
        () => {
          const result = normalizeViewport(undefined);
          expect(result.width).toBe(VIEWPORT_BOUNDS.width.default);
          expect(result.height).toBe(VIEWPORT_BOUNDS.height.default);
          expect(result.width).toBe(1280);
          expect(result.height).toBe(720);
        }
      ),
      { numRuns: 100 }
    );
  });
});
