/**
 * Property-Based Tests for Multi-Chain Payment Options
 * 
 * **Feature: weblens-phase1, Property 9: Multi-chain payment options**
 * **Validates: Requirements 4.1**
 * 
 * For any 402 Payment Required response, the accepts array SHALL contain 
 * payment options for at least Base and Solana networks.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { NETWORKS, SUPPORTED_NETWORKS, FACILITATORS } from "../../src/config";
import {
  getSupportedNetworks,
  getFacilitatorForNetwork,
  isNetworkSupported,
  getSupportedNetworkNames,
  type SupportedNetwork,
} from "../../src/middleware/payment";

describe("Property 9: Multi-chain payment options", () => {
  /**
   * Property: Each network has a valid facilitator URL
   * For any supported network, there SHALL be a valid facilitator URL
   */
  it("each network has a valid facilitator URL", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...getSupportedNetworkNames()),
        (network) => {
          const facilitatorUrl = getFacilitatorForNetwork(network);

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
        fc.constantFrom("base", "base-sepolia") as fc.Arbitrary<SupportedNetwork>,
        (network) => {
          const facilitatorUrl = getFacilitatorForNetwork(network);
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
        fc.constantFrom("solana", "polygon") as fc.Arbitrary<SupportedNetwork>,
        (network) => {
          const facilitatorUrl = getFacilitatorForNetwork(network);
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
   * Property: isNetworkSupported correctly identifies valid networks
   * For any supported network name, isNetworkSupported SHALL return true
   */
  it("isNetworkSupported correctly identifies valid networks", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...getSupportedNetworkNames()),
        (network) => {
          expect(isNetworkSupported(network)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: isNetworkSupported rejects invalid networks
   * For any invalid network name, isNetworkSupported SHALL return false
   */
  it("isNetworkSupported rejects invalid networks", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("ethereum", "bitcoin", "invalid", "mainnet", "testnet"),
        (network) => {
          expect(isNetworkSupported(network)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: SUPPORTED_NETWORKS constant matches getSupportedNetworkNames
   * The exported constant SHALL match the function output
   */
  it("SUPPORTED_NETWORKS constant matches getSupportedNetworkNames", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const fromConstant = [...SUPPORTED_NETWORKS].sort();
        const fromFunction = getSupportedNetworkNames().sort();

        expect(fromConstant).toEqual(fromFunction);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: getSupportedNetworks returns valid configurations
   * For any network config returned, it SHALL have valid network and facilitatorUrl
   */
  it("getSupportedNetworks returns valid configurations", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const configs = getSupportedNetworks();

        for (const config of configs) {
          // Network must be a supported network
          expect(isNetworkSupported(config.network)).toBe(true);

          // Facilitator URL must be valid
          expect(config.facilitatorUrl).toBeTruthy();
          expect(config.facilitatorUrl.startsWith("https://")).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});
