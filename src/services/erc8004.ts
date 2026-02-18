/**
 * ERC-8004 Reputation Registry
 * ABI and interface types for on-chain reputation lookups.
 *
 * ERC-8004 defines a minimal SBT (Soulbound Token) standard for
 * on-chain reputation: balanceOf to check token ownership, and
 * hasTrait to query specific reputation traits (e.g., "trusted-agent").
 */

/** ABI for the ERC-8004 Reputation Registry contract */
export const ERC_8004_ABI = [
    {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "owner", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
    },
    {
        type: "function",
        name: "hasTrait",
        stateMutability: "view",
        inputs: [
            { name: "owner", type: "address" },
            { name: "traitId", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
    },
    {
        type: "function",
        name: "reputationScore",
        stateMutability: "view",
        inputs: [{ name: "owner", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
    },
    {
        type: "event",
        name: "TraitGranted",
        inputs: [
            { name: "owner", type: "address", indexed: true },
            { name: "traitId", type: "uint256", indexed: true },
            { name: "grantor", type: "address", indexed: false },
        ],
    },
    {
        type: "event",
        name: "TraitRevoked",
        inputs: [
            { name: "owner", type: "address", indexed: true },
            { name: "traitId", type: "uint256", indexed: true },
        ],
    },
] as const;

/** Known reputation trait IDs */
export const REPUTATION_TRAITS = {
    TRUSTED_AGENT: 1n,
    VERIFIED_PUBLISHER: 2n,
    HIGH_VOLUME: 3n,
    BAZAAR_PARTICIPANT: 4n,
} as const;

/** Discount tiers based on reputation score ranges */
export const REPUTATION_DISCOUNT_TIERS = [
    { minScore: 1000n, discount: 0.30 },
    { minScore: 500n, discount: 0.20 },
    { minScore: 100n, discount: 0.10 },
    { minScore: 1n, discount: 0.05 },
] as const;

/** TypeScript interface for the ERC-8004 contract read results */
export interface ReputationData {
    balance: bigint;
    score: bigint;
    traits: {
        trustedAgent: boolean;
        verifiedPublisher: boolean;
        highVolume: boolean;
        bazaarParticipant: boolean;
    };
}

/** Configuration for the reputation registry contract */
export interface ReputationRegistryConfig {
    address: `0x${string}`;
    chainId: number;
}
