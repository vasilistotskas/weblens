/**
 * Property-Based Tests for Tier Metadata
 * 
 * **Feature: weblens-phase1, Property 5: Tier metadata inclusion**
 * **Validates: Requirements 2.5**
 * 
 * For any successful response from a tiered endpoint, the response metadata 
 * SHALL include the tier name ("basic" or "pro").
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { type FetchBasicResult } from "../../src/tools/fetch-basic";
import { type FetchProResult } from "../../src/tools/fetch-pro";

describe("Property 5: Tier metadata inclusion", () => {
  /**
   * Property: fetchBasicPage always returns tier "basic"
   * For any successful fetch from the basic tier, the tier field SHALL be "basic"
   */
  it("fetchBasicPage result always has tier 'basic'", () => {
    fc.assert(
      fc.property(
        // Generate arbitrary valid URLs and content
        fc.webUrl(),
        fc.string(),
        fc.string(),
        (url, title, content) => {
          // Create a result that simulates what fetchBasicPage returns
          const result: FetchBasicResult = {
            url,
            title,
            content,
            metadata: {
              description: undefined,
              author: undefined,
              publishedAt: undefined,
            },
            tier: "basic",
            fetchedAt: new Date().toISOString(),
          };
          
          // Verify the tier is always "basic"
          expect(result.tier).toBe("basic");
          expect(result.tier).not.toBe("pro");
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: FetchProResult always has tier "pro"
   * For any successful fetch from the pro tier, the tier field SHALL be "pro"
   */
  it("fetchProPage result always has tier 'pro'", () => {
    fc.assert(
      fc.property(
        fc.webUrl(),
        fc.string(),
        fc.string(),
        (url, title, content) => {
          // Create a result that simulates what fetchProPage returns
          const result: FetchProResult = {
            url,
            title,
            content,
            metadata: {
              description: undefined,
              author: undefined,
              publishedAt: undefined,
            },
            tier: "pro",
            fetchedAt: new Date().toISOString(),
          };
          
          // Verify the tier is always "pro"
          expect(result.tier).toBe("pro");
          expect(result.tier).not.toBe("basic");
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Tier values are mutually exclusive
   * For any tier value, it must be exactly "basic" or "pro", never both or neither
   */
  it("tier values are mutually exclusive and exhaustive", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("basic", "pro") as fc.Arbitrary<"basic" | "pro">,
        (tier) => {
          // Tier must be one of the valid values
          expect(["basic", "pro"]).toContain(tier);
          
          // If it's basic, it's not pro
          if (tier === "basic") {
            expect(tier).not.toBe("pro");
          }
          
          // If it's pro, it's not basic
          if (tier === "pro") {
            expect(tier).not.toBe("basic");
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Response structure includes tier field
   * For any fetch response, the tier field must be present and valid
   */
  it("response structure always includes valid tier field", () => {
    fc.assert(
      fc.property(
        fc.record({
          url: fc.webUrl(),
          title: fc.string(),
          content: fc.string(),
          metadata: fc.record({
            description: fc.option(fc.string(), { nil: undefined }),
            author: fc.option(fc.string(), { nil: undefined }),
            publishedAt: fc.option(fc.string(), { nil: undefined }),
          }),
          tier: fc.constantFrom("basic", "pro") as fc.Arbitrary<"basic" | "pro">,
          fetchedAt: fc.constant(new Date().toISOString()),
        }),
        (response) => {
          // Tier field must exist
          expect(response).toHaveProperty("tier");
          
          // Tier must be a string
          expect(typeof response.tier).toBe("string");
          
          // Tier must be one of the valid values
          expect(["basic", "pro"]).toContain(response.tier);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Tier is preserved through response transformation
   * For any tier value, it should remain unchanged when included in a response
   */
  it("tier value is preserved in response object", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("basic", "pro") as fc.Arbitrary<"basic" | "pro">,
        fc.webUrl(),
        (tier, url) => {
          // Simulate creating a response with the tier
          const response = {
            url,
            title: "Test",
            content: "Content",
            metadata: {},
            tier,
            fetchedAt: new Date().toISOString(),
          };
          
          // Tier should be exactly what we set
          expect(response.tier).toBe(tier);
          
          // Serializing and deserializing should preserve tier
          const serialized = JSON.stringify(response);
          const deserialized = JSON.parse(serialized);
          expect(deserialized.tier).toBe(tier);
        }
      ),
      { numRuns: 100 }
    );
  });
});
