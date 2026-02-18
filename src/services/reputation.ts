/**
 * Reputation Service
 * Checks ERC-8004 Reputation Registry for "Bazaar Discount".
 * 
 * Current Implementation: Mock/Placeholder
 */

// import { createPublicClient, http, parseAbi } from "viem";
// import { base } from "viem/chains";

// const REPUTATION_REGISTRY = "0x..."; // To be deployed
// const REPUTATION_ABI = parseAbi([
//   "function balanceOf(address owner) view returns (uint256)",
//   "function hasTrait(address owner, uint256 traitId) view returns (bool)"
// ]);

/**
 * Look up the reputation-based discount for a wallet address.
 * Returns a discount factor (0.0 to 1.0). Currently uses mock address prefixes;
 * will be upgraded to ERC-8004 contract reads in a future phase.
 */
export function getDiscount(address: string | undefined): number {
    if (!address) { return 0; }

    const normalized = address.toLowerCase();

    // 1. Mock Logic (Phase 1)
    if (normalized.startsWith("0xweb")) { return 0.20; } // 20% for WebLens holders
    if (normalized.startsWith("0xvip")) { return 0.50; } // 50% for VIPs
    if (normalized.startsWith("0xbaz")) { return 0.10; } // 10% for Bazaar users

    // 2. Future Logic (Phase 2 - Contract Read)
    /*
    try {
        const client = createPublicClient({ chain: base, transport: http() });
        const balance = await client.readContract({
            address: REPUTATION_REGISTRY,
            abi: REPUTATION_ABI,
            functionName: "balanceOf",
            args: [address as `0x${string}`]
        });
        
        if (balance > 0n) return 0.15;
    } catch (e) {
        console.warn("Reputation check failed:", e);
    }
    */

    return 0;
}
