/**
 * Payment funnel classification and the x402 hook recorders.
 *
 * Every outcome below is a real path a buyer can take; before this module most
 * of them produced no signal at all (a facilitator rejection arrives as a
 * normal verify result and never reached onVerifyFailure, and v1 headers and
 * pre-verify rejections were just 402s).
 */

import {
    encodePaymentRequiredHeader,
    encodePaymentResponseHeader,
    encodePaymentSignatureHeader,
} from "@x402/core/http";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentRequirements } from "@x402/core/types";
import { describe, expect, it, vi } from "vitest";
import {
    claimedPayer,
    classifyPaymentRequest,
    emitPaymentEvent,
    noteCanceled,
    noteSettled,
    noteSettleFailure,
    noteVerifyError,
    noteVerifyResult,
    PAYMENT_EVENT_BLOBS,
    runPaymentAttempt,
    TrackedFacilitatorClient,
} from "../../src/services/payment-telemetry";
import type { PaymentRequestFacts } from "../../src/services/payment-telemetry";
import type { Logger } from "../../src/utils/logger";

const BASE = "eip155:8453";

const requirements: PaymentRequirements = {
    scheme: "exact",
    network: BASE,
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    amount: "2000",
    payTo: "0xPayTo",
    maxTimeoutSeconds: 300,
    extra: {},
};

const challenge = encodePaymentRequiredHeader({
    x402Version: 2,
    error: "Payment required",
    resource: { url: "https://api.weblens.dev/fetch/basic", description: "", mimeType: "application/json" },
    accepts: [requirements],
} as Parameters<typeof encodePaymentRequiredHeader>[0]);

const signature = encodePaymentSignatureHeader({
    x402Version: 2,
    accepted: requirements,
    payload: {},
} as Parameters<typeof encodePaymentSignatureHeader>[0]);

function facts(overrides: Partial<PaymentRequestFacts>): PaymentRequestFacts {
    return {
        route: "/fetch/basic",
        requestId: "wl_test",
        status: 402,
        paymentSignature: undefined,
        v1Payment: undefined,
        paymentRequired: challenge,
        paymentResponse: null,
        wallUnavailable: false,
        latencyMs: 12,
        ...overrides,
    };
}

describe("classifyPaymentRequest", () => {
    it("an unpaid 402 is 'unpaid' and carries the quoted amount", () => {
        expect(classifyPaymentRequest(facts({}), {})).toMatchObject({ outcome: "unpaid", amount: "2000", route: "/fetch/basic" });
    });

    it("an x402 v1 X-PAYMENT header is 'v1_header'", () => {
        expect(classifyPaymentRequest(facts({ v1Payment: "eyJ4NDAyVmVyc2lvbiI6MX0=" }), {}).outcome).toBe("v1_header");
    });

    it("a payment header rejected before verify is 'rejected' with the challenge's reason", () => {
        const event = classifyPaymentRequest(facts({ paymentSignature: signature }), {});
        expect(event).toMatchObject({ outcome: "rejected", network: BASE, amount: "2000", reason: "Payment required" });
    });

    it("an undecodable payment header is 'rejected' as malformed", () => {
        const event = classifyPaymentRequest(facts({ paymentSignature: "not-base64-json", paymentRequired: null }), {});
        expect(event).toMatchObject({ outcome: "rejected", reason: "malformed Payment-Signature header" });
    });

    it("a hook-recorded outcome wins over header inference", () => {
        const event = classifyPaymentRequest(facts({ paymentSignature: signature }), {
            outcome: "verify_rejected",
            reason: "insufficient_funds",
            network: BASE,
            facilitator: "payai",
        });
        expect(event).toMatchObject({ outcome: "verify_rejected", reason: "insufficient_funds", facilitator: "payai" });
    });

    it("a settlement header without a hook outcome is still 'settled'", () => {
        const paymentResponse = encodePaymentResponseHeader({
            success: true, network: BASE, transaction: "0xtx", payer: "0xbuyer",
        } as Parameters<typeof encodePaymentResponseHeader>[0]);
        const event = classifyPaymentRequest(facts({ status: 200, paymentSignature: signature, paymentResponse, paymentRequired: null }), {});
        expect(event).toMatchObject({ outcome: "settled", transaction: "0xtx", payer: "0xbuyer", amount: "2000" });
    });

    it("a facilitator that cannot build a challenge is 'wall_unavailable'", () => {
        expect(classifyPaymentRequest(facts({ status: 503, wallUnavailable: true, paymentRequired: null }), {}).outcome)
            .toBe("wall_unavailable");
    });

    it("anything else is surfaced as 'unclassified', never silently dropped", () => {
        expect(classifyPaymentRequest(facts({ status: 400, paymentRequired: null }), {}).outcome).toBe("unclassified");
    });
});

describe("hook recorders", () => {
    it("record into the request's attempt", async () => {
        const { attempt } = await runPaymentAttempt(() => {
            noteVerifyResult(requirements, { isValid: false, invalidReason: "invalid_signature", invalidMessage: "bad sig", payer: "0xbuyer" });
            return Promise.resolve();
        });
        expect(attempt).toMatchObject({ outcome: "verify_rejected", reason: "invalid_signature: bad sig", payer: "0xbuyer", amount: "2000" });
    });

    it("a valid verify records the payer without an outcome", async () => {
        const { attempt } = await runPaymentAttempt(() => {
            noteVerifyResult(requirements, { isValid: true, payer: "0xbuyer" });
            return Promise.resolve();
        });
        expect(attempt.outcome).toBeUndefined();
        expect(attempt.payer).toBe("0xbuyer");
    });

    it.each([
        ["verify_error", () => { noteVerifyError(requirements, new Error("timeout")); }],
        ["settle_failed", () => { noteSettleFailure(requirements, new Error("gas")); }],
        ["canceled", () => { noteCanceled(requirements, "handler_failed", 502); }],
        ["settled", () => { noteSettled(requirements, { success: true, network: BASE, transaction: "0xtx", payer: "0xb" }); }],
    ] as const)("%s", async (outcome, record) => {
        const { attempt } = await runPaymentAttempt(() => {
            record();
            return Promise.resolve();
        });
        expect(attempt.outcome).toBe(outcome);
    });

    it("do nothing outside a payment attempt (e.g. during init)", () => {
        expect(() => { noteVerifyError(requirements, new Error("x")); }).not.toThrow();
    });

    it("keep concurrent requests apart", async () => {
        const [a, b] = await Promise.all([
            runPaymentAttempt(async () => {
                await new Promise((r) => setTimeout(r, 5));
                noteVerifyError(requirements, new Error("a"));
            }),
            runPaymentAttempt(() => {
                noteSettled(requirements, { success: true, network: BASE, transaction: "0xb", payer: "0xb" });
                return Promise.resolve();
            }),
        ]);
        expect(a.attempt.outcome).toBe("verify_error");
        expect(b.attempt.outcome).toBe("settled");
    });
});

describe("TrackedFacilitatorClient", () => {
    it("records which facilitator handled the request and delegates", async () => {
        const inner: FacilitatorClient = {
            verify: vi.fn(() => Promise.resolve({ isValid: true })),
            settle: vi.fn(() => Promise.resolve({ success: true, network: BASE, transaction: "0xtx" })),
            getSupported: vi.fn(() => Promise.resolve({ kinds: [], extensions: [], signers: {} })),
        };
        const client = new TrackedFacilitatorClient("cdp", inner);
        const payload = { x402Version: 2, accepted: requirements, payload: {} };

        const { attempt } = await runPaymentAttempt(() => client.settle(payload, requirements));

        expect(attempt.facilitator).toBe("cdp");
        expect(inner.settle).toHaveBeenCalledOnce();
    });
});

describe("emitPaymentEvent", () => {
    it("writes the blob columns in PAYMENT_EVENT_BLOBS order and never throws", () => {
        const writeDataPoint = vi.fn();
        const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() } as unknown as Logger;
        const event = { outcome: "settled" as const, route: "/search", requestId: "r1", network: BASE, payer: "0xbuyer", amount: "15000", latencyMs: 9 };

        emitPaymentEvent({ writeDataPoint }, log, event);

        const point = writeDataPoint.mock.calls[0]?.[0] as { blobs: string[]; doubles: number[]; indexes: string[] };
        expect(point.indexes).toEqual(["/search"]);
        expect(point.blobs[PAYMENT_EVENT_BLOBS.indexOf("outcome")]).toBe("settled");
        expect(point.blobs[PAYMENT_EVENT_BLOBS.indexOf("payer")]).toBe("0xbuyer");
        expect(point.doubles).toEqual([15000, 9]);

        const failing = { writeDataPoint: () => { throw new Error("binding missing"); } };
        expect(() => { emitPaymentEvent(failing, log, event); }).not.toThrow();
    });
});

describe("claimedPayer", () => {
    const PAYER = "0x1111111111111111111111111111111111111111";
    const evmSignature = (payload: Record<string, unknown>) =>
        encodePaymentSignatureHeader({ x402Version: 2, accepted: requirements, payload });

    it("reads the EIP-3009 and Permit2 `from` on EVM", () => {
        expect(claimedPayer({ x402Version: 2, accepted: requirements, payload: { authorization: { from: PAYER } } })).toBe(PAYER);
        expect(claimedPayer({ x402Version: 2, accepted: requirements, payload: { permit2Authorization: { from: PAYER } } })).toBe(PAYER);
        expect(claimedPayer({ x402Version: 2, accepted: requirements, payload: {} })).toBeUndefined();
    });

    it("names no payer for an undecodable Solana transaction, and never throws", () => {
        const solana = { ...requirements, network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" };
        expect(claimedPayer({ x402Version: 2, accepted: solana, payload: { transaction: "not-a-transaction" } })).toBeUndefined();
        expect(claimedPayer({ x402Version: 2, accepted: solana, payload: {} })).toBeUndefined();
    });

    it("attributes a verify error the facilitator named no payer for", () => {
        const event = classifyPaymentRequest(
            facts({ paymentSignature: evmSignature({ authorization: { from: PAYER } }), status: 402 }),
            { outcome: "verify_error", reason: "amount_too_low" },
        );
        expect(event).toMatchObject({ outcome: "verify_error", payer: PAYER });
    });

    it("attributes a payment rejected before verify", () => {
        const event = classifyPaymentRequest(
            facts({ paymentSignature: evmSignature({ authorization: { from: PAYER } }), paymentRequired: challenge, status: 402 }),
            {},
        );
        expect(event).toMatchObject({ outcome: "rejected", payer: PAYER });
    });
});
