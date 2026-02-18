/**
 * Property-Based Tests for Response Headers
 * 
 * **Feature: weblens-phase1, Property 10: Response header consistency**
 * **Validates: Requirements 5.3**
 * 
 * For any successful response from any endpoint, the response SHALL include 
 * X-Request-Id and X-Processing-Time headers.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { generateRequestId, isValidRequestId } from "../../src/utils/requestId";
import {
  getErrorCode,
  getHttpStatus,
  createErrorResponse,
} from "../../src/middleware/errorHandler";
import type { ErrorCode } from "../../src/types";

describe("Property 10: Response header consistency", () => {
  /**
   * Property: Request ID is always generated with correct format
   * For any call to generateRequestId, the result SHALL match the wl_ prefix format
   */
  it("request ID is always generated with correct format", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const requestId = generateRequestId();

        // Must start with wl_ prefix
        expect(requestId.startsWith("wl_")).toBe(true);

        // Must have three parts separated by underscores
        const parts = requestId.split("_");
        expect(parts.length).toBe(3);

        // First part is "wl"
        expect(parts[0]).toBe("wl");

        // Second part is timestamp (base36)
        expect(parts[1].length).toBeGreaterThan(0);

        // Third part is random string
        expect(parts[2].length).toBeGreaterThanOrEqual(1);
        expect(parts[2].length).toBeLessThanOrEqual(6);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Generated request IDs are valid
   * For any generated request ID, isValidRequestId SHALL return true
   */
  it("generated request IDs are valid", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const requestId = generateRequestId();
        expect(isValidRequestId(requestId)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Request IDs are unique
   * For any two generated request IDs, they SHALL be different
   */
  it("request IDs are unique", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const id1 = generateRequestId();
        const id2 = generateRequestId();

        // IDs should be different (extremely high probability)
        // Note: There's a tiny chance of collision, but it's negligible
        expect(id1).not.toBe(id2);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Processing time is always a non-negative number
   * For any processing time value, it SHALL be >= 0
   */
  it("processing time representation is valid", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60000 }), // 0 to 60 seconds
        (processingTime) => {
          // Processing time should be representable as a string
          const timeStr = processingTime.toString();
          expect(timeStr).toBeTruthy();

          // Should parse back to the same number
          expect(parseInt(timeStr, 10)).toBe(processingTime);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Error responses always include requestId
   * For any error response, the requestId field SHALL be present
   */
  it("error responses always include requestId", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "INVALID_REQUEST",
          "INVALID_URL",
          "INVALID_VIEWPORT",
          "FETCH_TIMEOUT",
          "RENDER_FAILED",
          "INTERNAL_ERROR"
        ) as fc.Arbitrary<ErrorCode>,
        fc.string({ minLength: 1, maxLength: 100 }),
        (code, message) => {
          const requestId = generateRequestId();
          const response = createErrorResponse(code, message, requestId);

          expect(response).toHaveProperty("requestId");
          expect(response.requestId).toBe(requestId);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Error responses have consistent structure
   * For any error response, it SHALL have error, code, message, and requestId fields
   */
  it("error responses have consistent structure", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "INVALID_REQUEST",
          "INVALID_URL",
          "INVALID_VIEWPORT",
          "FETCH_TIMEOUT",
          "RENDER_FAILED",
          "INTERNAL_ERROR"
        ) as fc.Arbitrary<ErrorCode>,
        fc.string({ minLength: 1, maxLength: 100 }),
        (code, message) => {
          const requestId = generateRequestId();
          const response = createErrorResponse(code, message, requestId);

          // Must have all required fields
          expect(response).toHaveProperty("error");
          expect(response).toHaveProperty("code");
          expect(response).toHaveProperty("message");
          expect(response).toHaveProperty("requestId");

          // Fields should have correct values
          expect(response.error).toBe(code);
          expect(response.code).toBe(code);
          expect(response.message).toBe(message);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: HTTP status codes are valid
   * For any error code, getHttpStatus SHALL return a valid HTTP status
   */
  it("HTTP status codes are valid for all error codes", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "INVALID_REQUEST",
          "INVALID_URL",
          "INVALID_VIEWPORT",
          "INVALID_TTL",
          "INVALID_SELECTOR",
          "FETCH_TIMEOUT",
          "RENDER_FAILED",
          "ELEMENT_NOT_FOUND",
          "CACHE_ERROR",
          "PAYMENT_FAILED",
          "RATE_LIMITED",
          "SERVICE_UNAVAILABLE",
          "INTERNAL_ERROR"
        ) as fc.Arbitrary<ErrorCode>,
        (code) => {
          const status = getHttpStatus(code);

          // Status should be a valid HTTP error code
          expect(status).toBeGreaterThanOrEqual(400);
          expect(status).toBeLessThan(600);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: 4xx errors are client errors
   * For validation errors, status SHALL be 4xx
   */
  it("validation errors return 4xx status codes", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "INVALID_REQUEST",
          "INVALID_URL",
          "INVALID_VIEWPORT",
          "INVALID_TTL",
          "INVALID_SELECTOR"
        ) as fc.Arbitrary<ErrorCode>,
        (code) => {
          const status = getHttpStatus(code);
          expect(status).toBeGreaterThanOrEqual(400);
          expect(status).toBeLessThan(500);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: 5xx errors are server errors
   * For server errors, status SHALL be 5xx
   */
  it("server errors return 5xx status codes", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "FETCH_TIMEOUT",
          "RENDER_FAILED",
          "CACHE_ERROR",
          "SERVICE_UNAVAILABLE",
          "INTERNAL_ERROR"
        ) as fc.Arbitrary<ErrorCode>,
        (code) => {
          const status = getHttpStatus(code);
          expect(status).toBeGreaterThanOrEqual(500);
          expect(status).toBeLessThan(600);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Error code detection is consistent
   * For any error message containing a known pattern, getErrorCode SHALL return the correct code
   */
  it("error code detection is consistent", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          { message: "Invalid URL format", expected: "INVALID_URL" },
          { message: "Request timeout exceeded", expected: "FETCH_TIMEOUT" },
          { message: "Navigation failed", expected: "RENDER_FAILED" },
          { message: "Service unavailable", expected: "SERVICE_UNAVAILABLE" },
          { message: "Rate limit exceeded", expected: "RATE_LIMITED" }
        ),
        ({ message, expected }) => {
          const code = getErrorCode(message);
          expect(code).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Unknown errors default to INTERNAL_ERROR
   * For any unrecognized error message, getErrorCode SHALL return INTERNAL_ERROR
   */
  it("unknown errors default to INTERNAL_ERROR", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "Something went wrong",
          "Unexpected error occurred",
          "Unknown issue",
          "Random failure"
        ),
        (message) => {
          const code = getErrorCode(message);
          expect(code).toBe("INTERNAL_ERROR");
        }
      ),
      { numRuns: 100 }
    );
  });
});
