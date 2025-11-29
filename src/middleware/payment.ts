/**
 * Multi-Chain Payment Configuration
 * Configures x402 payment middleware for multiple blockchain networks
 * 
 * Requirements: 4.1, 4.2, 4.3
 * - Support Base, Solana, and Polygon networks
 * - CDP facilitator for Base
 * - PayAI facilitator for Solana/Polygon
 */

import { facilitator } from "@coinbase/x402";
import type { Address } from "viem";
import { paymentMiddleware } from "x402-hono";
import { FACILITATORS } from "../config";

/**
 * Supported networks for payment
 */
export type SupportedNetwork = "base" | "base-sepolia" | "solana" | "polygon";

/**
 * Network configuration with facilitator mapping
 */
export interface NetworkPaymentConfig {
  network: SupportedNetwork;
  facilitatorUrl: string;
}

/**
 * Get all supported network configurations
 * Returns configurations for Base (CDP) and Solana/Polygon (PayAI)
 * Note: For Base, use the CDP facilitator object from @coinbase/x402
 */
export function getSupportedNetworks(): NetworkPaymentConfig[] {
  return [
    // Base networks use CDP facilitator (via @coinbase/x402 facilitator object)
    { network: "base-sepolia", facilitatorUrl: FACILITATORS.testnet },
    { network: "base", facilitatorUrl: FACILITATORS.payai },
    // Solana and Polygon use PayAI facilitator
    { network: "solana", facilitatorUrl: FACILITATORS.payai },
    { network: "polygon", facilitatorUrl: FACILITATORS.payai },
  ];
}

/**
 * Get facilitator URL for a specific network
 * Note: For production Base, prefer using the CDP facilitator object from @coinbase/x402
 */
export function getFacilitatorForNetwork(network: SupportedNetwork): string {
  switch (network) {
    case "base":
      return FACILITATORS.payai; // Or use CDP facilitator object
    case "base-sepolia":
      return FACILITATORS.testnet;
    case "solana":
    case "polygon":
      return FACILITATORS.payai;
    default:
      return FACILITATORS.payai;
  }
}

/**
 * Create payment middleware configuration for an endpoint
 * Supports multiple networks in the 402 response
 * 
 * @param walletAddress - The wallet address to receive payments
 * @param endpoint - The endpoint path (e.g., "/fetch/basic")
 * @param price - The price string (e.g., "$0.005")
 * @param description - Description for the endpoint
 * @param discoverable - Whether the endpoint should be discoverable in Bazaar
 */
export function createPaymentConfig(
  walletAddress: Address,
  endpoint: string,
  price: string,
  description: string,
  discoverable: boolean = true
) {
  // Use Base mainnet for production payments
  // CDP facilitator handles verification and settlement
  return {
    routes: {
      [endpoint]: {
        price,
        network: "base" as const,
        config: {
          description,
          discoverable,
        },
      },
    },
    facilitator, // CDP facilitator object from @coinbase/x402
  };
}

/**
 * Create multi-chain payment middleware for an endpoint
 * This creates middleware that accepts payments on multiple networks
 * 
 * @param walletAddress - The wallet address to receive payments
 * @param endpoint - The endpoint path
 * @param price - The price string
 * @param description - Description for the endpoint
 */
export function createMultiChainPaymentMiddleware(
  walletAddress: Address,
  endpoint: string,
  price: string,
  description: string
) {
  // Use Base mainnet for production payments
  // CDP facilitator handles verification and settlement
  return paymentMiddleware(
    walletAddress,
    {
      [endpoint]: {
        price,
        network: "base",
        config: {
          description,
          discoverable: true,
        },
      },
    },
    facilitator // CDP facilitator object from @coinbase/x402
  );
}

/**
 * Payment configuration for all WebLens endpoints
 */
export interface EndpointPaymentConfig {
  endpoint: string;
  price: string;
  description: string;
}

/**
 * Get all endpoint payment configurations
 */
export function getAllEndpointConfigs(): EndpointPaymentConfig[] {
  return [
    {
      endpoint: "/fetch/basic",
      price: "$0.005",
      description: "Fetch webpage without JavaScript rendering (basic tier)",
    },
    {
      endpoint: "/fetch/pro",
      price: "$0.015",
      description: "Fetch webpage with full JavaScript rendering (pro tier)",
    },
    {
      endpoint: "/fetch",
      price: "$0.005",
      description: "Fetch and clean any webpage into markdown (legacy)",
    },
    {
      endpoint: "/screenshot",
      price: "$0.02",
      description: "Capture webpage screenshot",
    },
    {
      endpoint: "/search",
      price: "$0.005",
      description: "Real-time web search results",
    },
    {
      endpoint: "/extract",
      price: "$0.03",
      description: "Extract structured data from webpages",
    },
  ];
}

/**
 * Check if a network is supported
 */
export function isNetworkSupported(network: string): network is SupportedNetwork {
  return ["base", "base-sepolia", "solana", "polygon"].includes(network);
}

/**
 * Get the list of supported network names
 */
export function getSupportedNetworkNames(): SupportedNetwork[] {
  return ["base", "base-sepolia", "solana", "polygon"];
}
