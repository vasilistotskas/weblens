/**
 * Property-Based Tests for URL Validation
 * 
 * **Feature: weblens-phase1, Property 11: Error response format consistency**
 * **Validates: Requirements 5.4**
 * 
 * For any error response (4xx or 5xx status), the response body SHALL contain
 * error, code, message, and requestId fields.
 * 
 * This test validates that the URL validator returns consistent error formats
 * that can be used to construct proper error responses.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { validateURL, isValidURL } from "../../src/services/validator";

describe("Property 11: Error response format consistency (URL Validation)", () => {
  /**
   * Property: Invalid URLs always return an error message
   * For any invalid URL, validateURL returns { valid: false, error: string }
   */
  it("invalid URLs always return an error message", () => {
    fc.assert(
      fc.property(
        // Generate invalid URL strings
        fc.oneof(
          fc.constant(""),
          fc.constant("   "),
          fc.constant("not-a-url"),
          fc.constant("ftp://example.com"),
          fc.constant("file:///etc/passwd"),
          fc.constant("javascript:alert(1)"),
          fc.constant("data:text/html,<script>"),
          fc.constant("http://localhost"),
          fc.constant("http://127.0.0.1"),
          fc.constant("http://0.0.0.0"),
          fc.constant("http://192.168.1.1"),
          fc.constant("http://10.0.0.1"),
          fc.constant("http://172.16.0.1"),
          fc.constant("http://example.local"),
          fc.constant("http://test.internal")
        ),
        (invalidUrl) => {
          const result = validateURL(invalidUrl);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
          expect(typeof result.error).toBe("string");
          expect(result.error!.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Valid URLs always return normalized URL without error
   * For any valid HTTP/HTTPS URL, validateURL returns { valid: true, normalized: string }
   */
  it("valid URLs always return normalized URL without error", () => {
    fc.assert(
      fc.property(
        // Generate valid domain names and paths
        fc.record({
          protocol: fc.constantFrom("http", "https"),
          domain: fc.stringMatching(/^[a-z][a-z0-9-]{0,20}\.[a-z]{2,6}$/),
          path: fc.stringMatching(/^(\/[a-z0-9-]{1,10}){0,3}$/)
        }),
        ({ protocol, domain, path }) => {
          const url = `${protocol}://${domain}${path}`;
          const result = validateURL(url);
          expect(result.valid).toBe(true);
          expect(result.normalized).toBeDefined();
          expect(result.error).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Blocked hosts are consistently rejected
   * For any private/internal IP or hostname, validation fails with appropriate error
   */
  it("blocked hosts are consistently rejected with error message", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          // Localhost variants
          fc.constant("http://localhost"),
          fc.constant("https://localhost:8080"),
          fc.constant("http://127.0.0.1"),
          fc.constant("http://127.0.0.1:3000"),
          // Private IP ranges
          fc.integer({ min: 0, max: 255 }).chain(d => 
            fc.constant(`http://10.0.0.${d}`)
          ),
          fc.integer({ min: 0, max: 255 }).chain(d => 
            fc.constant(`http://192.168.1.${d}`)
          ),
          fc.integer({ min: 16, max: 31 }).chain(d => 
            fc.constant(`http://172.${d}.0.1`)
          ),
          // Local domains
          fc.stringMatching(/^[a-z]{3,8}$/).map(s => `http://${s}.local`),
          fc.stringMatching(/^[a-z]{3,8}$/).map(s => `http://${s}.internal`)
        ),
        (blockedUrl) => {
          const result = validateURL(blockedUrl);
          expect(result.valid).toBe(false);
          expect(result.error).toBe("Internal URLs not allowed");
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Non-HTTP protocols are rejected with appropriate error
   * For any URL with non-HTTP/HTTPS protocol, validation fails
   */
  it("non-HTTP protocols are rejected with appropriate error", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "ftp://example.com",
          "file:///etc/passwd",
          "javascript:alert(1)",
          "data:text/html,test",
          "mailto:test@example.com",
          "tel:+1234567890",
          "ssh://example.com",
          "ws://example.com",
          "wss://example.com"
        ),
        (nonHttpUrl) => {
          const result = validateURL(nonHttpUrl);
          expect(result.valid).toBe(false);
          expect(result.error).toBe("Only HTTP/HTTPS URLs allowed");
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: isValidURL is consistent with validateURL
   * For any input, isValidURL(x) === validateURL(x).valid
   */
  it("isValidURL is consistent with validateURL", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.webUrl(),
          fc.string(),
          fc.constant(""),
          fc.constant("http://localhost"),
          fc.constant("https://example.com")
        ),
        (input) => {
          const validationResult = validateURL(input);
          const isValid = isValidURL(input);
          expect(isValid).toBe(validationResult.valid);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Normalized URLs are valid URLs
   * For any valid URL, the normalized result is also a valid URL
   */
  it("normalized URLs are themselves valid URLs", () => {
    fc.assert(
      fc.property(
        fc.webUrl(),
        (url) => {
          const result = validateURL(url);
          if (result.valid && result.normalized) {
            // The normalized URL should also be valid
            const revalidated = validateURL(result.normalized);
            expect(revalidated.valid).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
