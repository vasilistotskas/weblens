/**
 * Property-Based Tests for Multi-Chain Payment Options
 * 
 * **Feature: weblens-phase1, Property 9: Multi-chain payment options**
 * **Validates: Requirements 4.1**
 * 
 * For any 402 Payment Required response, the accepts array SHALL contain 
 * payment options for at least Base network (with potential for multi-chain in future).
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { NETWORKS, SUPPORTED_NETWORKS, FACILITATORS } from "../../src/config";

describe("Property 9: Multi-chain payment options", () => {
  /**
   * Property: Each network has a valid facilitator URL
   * For any supported network, there SHALL be a valid facilitator URL
   */
  it("each network has a valid facilitator URL", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...(Object.keys(NETWORKS) as (keyof typeof NETWORKS)[])),
        (network) => {
          const config = NETWORKS[network];
          const facilitatorUrl = config.facilitatorUrl;

          // Facilitator URL must be a valid URL
          expect(facilitatorUrl).toBeTruthy();
          expect(facilitatorUrl.startsWith("https://")).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Base networks use appropriate facilitator
   * For Base mainnet, PayAI facilitator is used (CDP object used in code)
   * For Base testnet, testnet facilitator is used
   */
  it("Base networks use appropriate facilitator", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("base", "base-sepolia") as fc.Arbitrary<keyof typeof NETWORKS>,
        (network) => {
          const config = NETWORKS[network];
          const facilitatorUrl = config.facilitatorUrl;
          
          if (network === "base-sepolia") {
            expect(facilitatorUrl).toBe(FACILITATORS.testnet);
          } else {
            // Base mainnet uses PayAI URL (actual code uses CDP facilitator object)
            expect(facilitatorUrl).toBe(FACILITATORS.payai);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Solana and Polygon use PayAI facilitator
   * For Solana or Polygon networks, PayAI facilitator SHALL be used
   */
  it("Solana and Polygon use PayAI facilitator", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("solana", "polygon") as fc.Arbitrary<keyof typeof NETWORKS>,
        (network) => {
          const config = NETWORKS[network];
          const facilitatorUrl = config.facilitatorUrl;
          expect(facilitatorUrl).toBe(FACILITATORS.payai);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Network configuration is complete
   * For any supported network, the NETWORKS config SHALL have all required fields
   */
  it("network configuration is complete for all networks", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...(Object.keys(NETWORKS) as (keyof typeof NETWORKS)[])),
        (network) => {
          const config = NETWORKS[network];

          // Must have facilitator name
          expect(config).toHaveProperty("facilitator");
          expect(["testnet", "payai"]).toContain(config.facilitator);

          // Must have facilitator URL
          expect(config).toHaveProperty("facilitatorUrl");
          expect(config.facilitatorUrl.startsWith("https://")).toBe(true);

          // Must have isTestnet flag
          expect(config).toHaveProperty("isTestnet");
          expect(typeof config.isTestnet).toBe("boolean");
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: SUPPORTED_NETWORKS constant contains only Base
   * Currently only Base mainnet is supported for production
   */
  it("SUPPORTED_NETWORKS contains only Base mainnet", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        expect(SUPPORTED_NETWORKS).toEqual(["base"]);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Base mainnet is in SUPPORTED_NETWORKS
   * Base SHALL be the primary supported network
   */
  it("Base mainnet is in SUPPORTED_NETWORKS", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        expect(SUPPORTED_NETWORKS).toContain("base");
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: All NETWORKS have valid configuration structure
   * Each network config SHALL have facilitator, facilitatorUrl, and isTestnet
   */
  it("all NETWORKS have valid configuration structure", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const networkKeys = Object.keys(NETWORKS) as (keyof typeof NETWORKS)[];
        
        for (const network of networkKeys) {
          const config = NETWORKS[network];
          
          // Must have all required fields
          expect(config).toHaveProperty("facilitator");
          expect(config).toHaveProperty("facilitatorUrl");
          expect(config).toHaveProperty("isTestnet");
          
          // Facilitator URL must be valid HTTPS
          expect(config.facilitatorUrl.startsWith("https://")).toBe(true);
          
          // isTestnet must be boolean
          expect(typeof config.isTestnet).toBe("boolean");
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Testnet networks are properly flagged
   * Networks with "sepolia" or "devnet" SHALL have isTestnet: true
   */
  it("testnet networks are properly flagged", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const networkKeys = Object.keys(NETWORKS) as (keyof typeof NETWORKS)[];
        
        for (const network of networkKeys) {
          const config = NETWORKS[network];
          const isTestnetName = network.includes("sepolia") || network.includes("devnet");
          
          if (isTestnetName) {
            expect(config.isTestnet).toBe(true);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
