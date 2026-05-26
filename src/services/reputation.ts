/**
 * Reputation Service
 * Checks ERC-8004 Reputation Registry for "Bazaar Discount".
 * 
 * Current Implementation: Mock/Placeholder
 */

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

    return 0;
}
