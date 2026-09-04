/**
 * Which networks WebLens advertises, and when.
 *
 * Two things make this worth pinning rather than eyeballing:
 *
 * 1. A CAIP-2 id typo is silent and total. The id has to match what the
 *    facilitator advertises on /supported exactly, or `initialize()` finds no
 *    supported kind for it and `buildPaymentRequirements` throws for every
 *    request on the route — the payment wall turns 402s into 5xx.
 * 2. Solana must stay off until a payout address exists. An SVM `exact`
 *    payment is an SPL TransferChecked into the payee's associated token
 *    account and the spec makes the facilitator verify that account exists, so
 *    advertising Solana with no address would issue challenges that can never
 *    settle.
 */

import { describe, expect, it } from "vitest";
import { evmNetwork, NETWORKS, supportedNetworks, svmNetwork } from "../../src/config";

/** Any well-formed base58 address; these tests never settle anything. */
const SVM_ADDRESS = "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4";

describe("CAIP-2 identifiers", () => {
    // Verified against facilitator.payai.network/supported, which advertises
    // `exact` on both of these. Changing a character here breaks every payment
    // on that network, so the literals are pinned.
    it("are the exact ids the facilitator advertises", () => {
        expect(NETWORKS.baseMainnet).toBe("eip155:8453");
        expect(NETWORKS.baseSepolia).toBe("eip155:84532");
        expect(NETWORKS.solanaMainnet).toBe("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
        expect(NETWORKS.solanaDevnet).toBe("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
    });

    it("are all CAIP-2 shaped", () => {
        for (const [name, id] of Object.entries(NETWORKS)) {
            expect(id, name).toMatch(/^[a-z0-9]+:[A-Za-z0-9]+$/u);
        }
    });
});

describe("EVM network selection", () => {
    it("defaults to Base mainnet", () => {
        expect(evmNetwork({})).toBe(NETWORKS.baseMainnet);
        expect(evmNetwork({ NETWORK: "base" })).toBe(NETWORKS.baseMainnet);
    });

    it("switches to Base Sepolia on the testnet deployment", () => {
        expect(evmNetwork({ NETWORK: "base-sepolia" })).toBe(NETWORKS.baseSepolia);
    });
});

describe("Solana network selection", () => {
    it("is off until a payout address is configured", () => {
        expect(svmNetwork({})).toBeUndefined();
        expect(svmNetwork({ NETWORK: "base" })).toBeUndefined();
    });

    it("stays off for a blank or whitespace-only address", () => {
        // An empty [vars] entry is the likely misconfiguration, and it must not
        // advertise a network with an unusable payTo.
        expect(svmNetwork({ PAY_TO_ADDRESS_SVM: "" })).toBeUndefined();
        expect(svmNetwork({ PAY_TO_ADDRESS_SVM: "   " })).toBeUndefined();
    });

    it("turns on with an address, mainnet by default", () => {
        expect(svmNetwork({ PAY_TO_ADDRESS_SVM: SVM_ADDRESS })).toBe(NETWORKS.solanaMainnet);
    });

    it("pairs the testnet deployment with Solana devnet", () => {
        expect(
            svmNetwork({ NETWORK: "base-sepolia", PAY_TO_ADDRESS_SVM: SVM_ADDRESS })
        ).toBe(NETWORKS.solanaDevnet);
    });
});

describe("advertised networks", () => {
    it("names Base alone while Solana is off", () => {
        expect(supportedNetworks({})).toEqual([NETWORKS.baseMainnet]);
    });

    it("names both once Solana is configured", () => {
        expect(supportedNetworks({ PAY_TO_ADDRESS_SVM: SVM_ADDRESS })).toEqual([
            NETWORKS.baseMainnet,
            NETWORKS.solanaMainnet,
        ]);
    });

    it("keeps testnet on testnet chains", () => {
        expect(
            supportedNetworks({ NETWORK: "base-sepolia", PAY_TO_ADDRESS_SVM: SVM_ADDRESS })
        ).toEqual([NETWORKS.baseSepolia, NETWORKS.solanaDevnet]);
    });

    it("advertises CAIP-2 ids, so an agent can match them against a 402 challenge", () => {
        // The challenge's accepts[].network is CAIP-2; discovery used to say
        // "base", which matched nothing a buyer receives.
        for (const id of supportedNetworks({ PAY_TO_ADDRESS_SVM: SVM_ADDRESS })) {
            expect(id).toMatch(/^[a-z0-9]+:[A-Za-z0-9]+$/u);
        }
    });
});
