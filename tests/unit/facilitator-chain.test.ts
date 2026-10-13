/**
 * The facilitator chain: one x402 facilitator slot per network family, tried
 * in order. It is what lets Base settle through CDP (which indexes WebLens in
 * the CDP Bazaar) without losing the payment when CDP fails, and what keeps a
 * Solana quote bound to the one facilitator whose fee payer it names.
 */

import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements, SettleResponse, SupportedResponse, VerifyResponse } from "@x402/core/types";
import { describe, expect, it, vi } from "vitest";
import { FacilitatorChain, parseFacilitatorOrder } from "../../src/services/facilitator-chain";
import { runPaymentAttempt, TrackedFacilitatorClient } from "../../src/services/payment-telemetry";
import type { FacilitatorLabel } from "../../src/services/payment-telemetry";
import type { Logger } from "../../src/utils/logger";

const BASE = "eip155:8453";
const SOLANA = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

const requirements: PaymentRequirements = {
    scheme: "exact",
    network: BASE,
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    amount: "4000",
    payTo: "0x5f71Ce4135004b5fa4dF81014721598E1C7c5AF8",
    maxTimeoutSeconds: 300,
    extra: {},
};
const payload: PaymentPayload = { x402Version: 2, accepted: requirements, payload: { authorization: { from: "0xbuyer" } } };

const SUPPORTED: SupportedResponse = {
    kinds: [
        { x402Version: 2, scheme: "exact", network: BASE },
        { x402Version: 2, scheme: "exact", network: SOLANA, extra: { feePayer: "FeePayer" } },
    ],
    extensions: ["bazaar"],
    signers: {},
};

const settled = (transaction: string): SettleResponse => ({ success: true, transaction, network: BASE, payer: "0xbuyer" });
const notSettled: SettleResponse = { success: false, errorReason: "unable_to_estimate_gas", transaction: "", network: BASE };
const valid: VerifyResponse = { isValid: true, payer: "0xbuyer" };
const invalid: VerifyResponse = { isValid: false, invalidReason: "insufficient_funds", payer: "0xbuyer" };

/** A facilitator whose answers the test scripts; a thrown Error stands for a transport or HTTP failure. */
function facilitator(answers: {
    supported?: SupportedResponse | Error;
    verify?: VerifyResponse | Error;
    settle?: SettleResponse | Error;
}): FacilitatorClient & { verify: ReturnType<typeof vi.fn>; settle: ReturnType<typeof vi.fn> } {
    const answer = <T>(value: T | Error | undefined): Promise<T> =>
        value instanceof Error ? Promise.reject(value) : value === undefined ? Promise.reject(new Error("unscripted")) : Promise.resolve(value);
    return {
        getSupported: vi.fn(() => answer(answers.supported)),
        verify: vi.fn(() => answer(answers.verify)),
        settle: vi.fn(() => answer(answers.settle)),
    };
}

function silentLog(): Logger & { warn: ReturnType<typeof vi.fn> } {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
    log.child.mockReturnValue(log);
    return log;
}

function chain(family: "eip155" | "solana", ...links: [FacilitatorLabel, FacilitatorClient][]) {
    const log = silentLog();
    const [first, ...rest] = links.map(([label, client]) => new TrackedFacilitatorClient(label, client));
    if (!first) { throw new Error("a chain needs a facilitator"); }
    return { chain: new FacilitatorChain(family, [first, ...rest], log), log };
}

describe("parseFacilitatorOrder", () => {
    it("reads an ordered, comma-separated list", () => {
        expect(parseFacilitatorOrder("eip155", "cdp, payai")).toEqual(["cdp", "payai"]);
        expect(parseFacilitatorOrder("solana", "payai")).toEqual(["payai"]);
    });

    it("rejects an empty, unknown or repeated list", () => {
        expect(() => parseFacilitatorOrder("eip155", undefined)).toThrow(/No facilitators/u);
        expect(() => parseFacilitatorOrder("eip155", " , ")).toThrow(/No facilitators/u);
        expect(() => parseFacilitatorOrder("eip155", "cdp,stripe")).toThrow(/Unknown/u);
        expect(() => parseFacilitatorOrder("eip155", "cdp,cdp")).toThrow(/twice/u);
    });

    it("allows one Solana facilitator only, because its fee payer is part of the quote", () => {
        expect(() => parseFacilitatorOrder("solana", "payai,cdp")).toThrow(/only one Solana facilitator/u);
    });
});

describe("FacilitatorChain", () => {
    it("advertises only its own family's kinds", async () => {
        const { chain: evm } = chain("eip155", ["cdp", facilitator({ supported: SUPPORTED })]);
        const { chain: svm } = chain("solana", ["payai", facilitator({ supported: SUPPORTED })]);

        expect((await evm.getSupported()).kinds.map((k) => k.network)).toEqual([BASE]);
        expect((await svm.getSupported()).kinds.map((k) => k.network)).toEqual([SOLANA]);
        expect((await evm.getSupported()).extensions).toEqual(["bazaar"]);
    });

    it("takes the kinds from the next facilitator when the first cannot answer /supported", async () => {
        const { chain: evm, log } = chain("eip155",
            ["cdp", facilitator({ supported: new Error("CDP down") })],
            ["payai", facilitator({ supported: SUPPORTED })]);

        expect((await evm.getSupported()).kinds).toHaveLength(1);
        expect(log.warn).toHaveBeenCalledWith("facilitator.supported_failed", expect.objectContaining({ facilitator: "cdp" }));
    });

    it("settles through the first facilitator and never touches the next", async () => {
        const cdp = facilitator({ verify: valid, settle: settled("0xcdp") });
        const payai = facilitator({ verify: valid, settle: settled("0xpayai") });
        const { chain: evm } = chain("eip155", ["cdp", cdp], ["payai", payai]);

        await expect(evm.verify(payload, requirements)).resolves.toEqual(valid);
        await expect(evm.settle(payload, requirements)).resolves.toMatchObject({ transaction: "0xcdp" });
        expect(payai.verify).not.toHaveBeenCalled();
        expect(payai.settle).not.toHaveBeenCalled();
    });

    it("hands a payment to the next facilitator when the first fails to settle it, and records the handover", async () => {
        for (const [failure, reason] of [[notSettled, "unable_to_estimate_gas"], [new Error("timeout"), "timeout"]] as const) {
            const cdp = facilitator({ settle: failure });
            const payai = facilitator({ settle: settled("0xpayai") });
            const { chain: evm, log } = chain("eip155", ["cdp", cdp], ["payai", payai]);

            const { result, attempt } = await runPaymentAttempt(() => evm.settle(payload, requirements));

            expect(result).toMatchObject({ success: true, transaction: "0xpayai" });
            expect(attempt.facilitator).toBe("payai");
            // Recorded in the (unsampled) funnel event, not only the (sampled) log.
            expect(attempt.fallbacks).toEqual([`cdp settle: ${reason}`]);
            expect(log.warn).toHaveBeenCalledWith("facilitator.fallback", expect.objectContaining({ operation: "settle", facilitator: "cdp", next: "payai" }));
        }
    });

    it("records a verify handover, but not the chain's final failure, which is the outcome's own reason", async () => {
        const { chain: verifyChain } = chain("eip155", ["cdp", facilitator({ verify: new Error("CDP 500") })], ["payai", facilitator({ verify: valid })]);
        const verified = await runPaymentAttempt(() => verifyChain.verify(payload, requirements));
        expect(verified.attempt.fallbacks).toEqual(["cdp verify: CDP 500"]);

        const { chain: exhausted } = chain("eip155", ["cdp", facilitator({ settle: notSettled })], ["payai", facilitator({ settle: notSettled })]);
        const failed = await runPaymentAttempt(() => exhausted.settle(payload, requirements));
        expect(failed.attempt.fallbacks).toEqual(["cdp settle: unable_to_estimate_gas"]);
    });

    it("verifies through the next facilitator when the first errors or rejects", async () => {
        for (const first of [new Error("CDP 500"), invalid]) {
            const { chain: evm } = chain("eip155", ["cdp", facilitator({ verify: first })], ["payai", facilitator({ verify: valid })]);
            await expect(evm.verify(payload, requirements)).resolves.toEqual(valid);
        }
    });

    it("returns the first rejection when no facilitator accepts the payment", async () => {
        const { chain: evm } = chain("eip155",
            ["cdp", facilitator({ verify: invalid })],
            ["payai", facilitator({ verify: new Error("PayAI 502") })]);

        await expect(evm.verify(payload, requirements)).resolves.toEqual(invalid);
    });

    it("reports the last facilitator's outcome when none settles", async () => {
        const { chain: failedLast, log } = chain("eip155",
            ["cdp", facilitator({ settle: new Error("CDP down") })],
            ["payai", facilitator({ settle: notSettled })]);
        await expect(failedLast.settle(payload, requirements)).resolves.toEqual(notSettled);
        expect(log.warn).toHaveBeenCalledWith("facilitator.exhausted", expect.objectContaining({ facilitator: "payai" }));

        const { chain: threwLast } = chain("eip155",
            ["cdp", facilitator({ settle: notSettled })],
            ["payai", facilitator({ settle: new Error("PayAI down") })]);
        await expect(threwLast.settle(payload, requirements)).rejects.toThrow("PayAI down");
    });
});
