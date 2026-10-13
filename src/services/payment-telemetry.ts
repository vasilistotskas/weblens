/**
 * Payment funnel telemetry: one event per paid-route request, written to
 * Workers Analytics Engine (adaptively sampled, 3-month retention) and to the
 * structured log.
 *
 * Why both: Workers Logs are head-sampled at 10%, which drops 90% of rare
 * payment events, and they carry no reliable signal for payment attempts. The
 * Analytics Engine dataset is the funnel's source of truth
 * (`scripts/payment-funnel.ts` queries it); the log line carries debugging
 * context for the requests that happen to be sampled.
 *
 * How events are assembled: the x402 lifecycle hooks registered in
 * `middleware/payment.ts` fire inside `@x402/core`, which knows nothing about
 * the Hono request. They record what happened into the request's
 * `PaymentAttempt` (an AsyncLocalStorage scope opened around the payment wall),
 * and the payment middleware emits exactly one event per request from that
 * attempt plus the request/response headers — so each request is counted once.
 */

import { decodePaymentRequiredHeader, decodePaymentResponseHeader, decodePaymentSignatureHeader } from "@x402/core/http";
import type { FacilitatorClient } from "@x402/core/server";
import type {
    PaymentPayload,
    PaymentRequirements,
    SettleResponse,
    SupportedResponse,
    VerifyResponse,
} from "@x402/core/types";
import { decodeTransactionFromPayload, getTokenPayerFromTransaction } from "@x402/svm";
import { AsyncLocalStorage } from "node:async_hooks";
import { mask } from "../utils/logger";
import type { Logger } from "../utils/logger";
import { isRecord } from "../utils/narrow";

/**
 * Where a paid-route request ended up.
 * - `unpaid`: a 402 challenge for a request that carried no payment (probes, first contact).
 * - `v1_header`: an x402 v1 `X-PAYMENT` header, which this v2 server cannot accept.
 * - `rejected`: a payment header rejected before the facilitator verified it
 *   (malformed, unsupported scheme/network, no matching requirement).
 * - `verify_rejected`: the facilitator answered verify with `isValid: false`.
 * - `verify_error`: verify failed in transport or with a facilitator HTTP error.
 * - `settled`: the payment settled on-chain.
 * - `settle_failed`: verified, the handler ran, settlement failed.
 * - `canceled`: verified, but the handler failed so settlement was cancelled (nothing charged).
 * - `wall_unavailable`: the facilitator did not advertise our scheme/network; no challenge could be built.
 * - `unclassified`: none of the above matched — investigate.
 */
export type PaymentOutcome =
    | "unpaid"
    | "v1_header"
    | "rejected"
    | "verify_rejected"
    | "verify_error"
    | "settled"
    | "settle_failed"
    | "canceled"
    | "wall_unavailable"
    | "unclassified";

/** What the x402 hooks learned about the payment on this request. */
export interface PaymentAttempt {
    outcome?: Extract<PaymentOutcome, "verify_rejected" | "verify_error" | "settled" | "settle_failed" | "canceled">;
    reason?: string;
    network?: string;
    scheme?: string;
    /** Atomic units of the requirement being paid. */
    amount?: string;
    payer?: string;
    transaction?: string;
    /** Label of the facilitator that last handled verify/settle. */
    facilitator?: string;
    /** Failures one facilitator had that the next in its chain took over (see noteFallback). */
    fallbacks?: string[];
}

export interface PaymentEvent {
    outcome: PaymentOutcome;
    route: string;
    requestId: string;
    network?: string;
    scheme?: string;
    facilitator?: string;
    reason?: string;
    payer?: string;
    transaction?: string;
    /** Atomic units: what was paid, or what the challenge quoted. */
    amount?: string;
    /**
     * Failures absorbed by a facilitator fallback on this request, e.g.
     * "cdp settle: unable_to_estimate_gas". `facilitator` names only the one
     * that answered last, so without this a sale PayAI rescued would read as
     * an ordinary PayAI sale and CDP's failure rate would be invisible.
     */
    fallback?: string;
    latencyMs: number;
}

/**
 * Column layout of each Analytics Engine data point. `index1` is the route.
 * The funnel script reads columns through these, so writer and reader cannot
 * drift apart.
 */
export const PAYMENT_EVENT_BLOBS = [
    "outcome",
    "network",
    "scheme",
    "facilitator",
    "reason",
    "payer",
    "transaction",
    "requestId",
    // Appended, never inserted: existing rows keep their blob positions.
    "fallback",
] as const satisfies readonly (keyof PaymentEvent)[];

export const PAYMENT_EVENT_DOUBLES = ["amount", "latencyMs"] as const satisfies readonly (keyof PaymentEvent)[];

const attempts = new AsyncLocalStorage<PaymentAttempt>();

/** Run `fn` with a fresh payment attempt in scope; returns its result and the attempt. */
export async function runPaymentAttempt<T>(fn: () => Promise<T>): Promise<{ result: T; attempt: PaymentAttempt }> {
    const attempt: PaymentAttempt = {};
    const result = await attempts.run(attempt, fn);
    return { result, attempt };
}

/** The attempt for the current request, or undefined outside a payment wall (e.g. init). */
function currentAttempt(): PaymentAttempt | undefined {
    return attempts.getStore();
}

function noteRequirements(attempt: PaymentAttempt, requirements: Readonly<PaymentRequirements>): void {
    attempt.network = requirements.network;
    attempt.scheme = requirements.scheme;
    attempt.amount = requirements.amount;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// ---- Hook recorders (called from the x402ResourceServer hooks) ----

/** Longest failure reason kept per fallback; facilitator error messages can be long. */
const FALLBACK_REASON_CHARS = 120;

/**
 * Record a failure one facilitator had that the next in its chain took over
 * (FacilitatorChain). The final failure of a chain is not a fallback: it is
 * the outcome's own reason.
 */
export function noteFallback(operation: "verify" | "settle", facilitator: FacilitatorLabel, reason: string): void {
    const attempt = currentAttempt();
    if (!attempt) { return; }
    (attempt.fallbacks ??= []).push(`${facilitator} ${operation}: ${reason.slice(0, FALLBACK_REASON_CHARS)}`);
}

export function noteVerifyResult(requirements: Readonly<PaymentRequirements>, result: Readonly<VerifyResponse>): void {
    const attempt = currentAttempt();
    if (!attempt) { return; }
    noteRequirements(attempt, requirements);
    attempt.payer = result.payer;
    if (!result.isValid) {
        attempt.outcome = "verify_rejected";
        attempt.reason = [result.invalidReason, result.invalidMessage].filter(Boolean).join(": ") || "invalid";
    }
}

export function noteVerifyError(requirements: Readonly<PaymentRequirements>, error: unknown): void {
    const attempt = currentAttempt();
    if (!attempt) { return; }
    noteRequirements(attempt, requirements);
    attempt.outcome = "verify_error";
    attempt.reason = errorMessage(error);
}

export function noteSettled(requirements: Readonly<PaymentRequirements>, result: Readonly<SettleResponse>): void {
    const attempt = currentAttempt();
    if (!attempt) { return; }
    noteRequirements(attempt, requirements);
    attempt.outcome = "settled";
    attempt.network = result.network;
    attempt.payer = result.payer ?? attempt.payer;
    attempt.transaction = result.transaction;
    if (result.amount) { attempt.amount = result.amount; }
}

export function noteSettleFailure(requirements: Readonly<PaymentRequirements>, error: unknown): void {
    const attempt = currentAttempt();
    if (!attempt) { return; }
    noteRequirements(attempt, requirements);
    attempt.outcome = "settle_failed";
    attempt.reason = errorMessage(error);
}

export function noteCanceled(requirements: Readonly<PaymentRequirements>, reason: string, responseStatus: number | undefined): void {
    const attempt = currentAttempt();
    if (!attempt) { return; }
    noteRequirements(attempt, requirements);
    attempt.outcome = "canceled";
    attempt.reason = responseStatus === undefined ? reason : `${reason} (${String(responseStatus)})`;
}

/**
 * Facilitator client that records which facilitator handled the request.
 * Delegates everything; `@x402/core` only ever calls these three methods.
 */
/** The facilitators WebLens can settle through (facilitatorPlans in middleware/payment.ts). */
export type FacilitatorLabel = "payai" | "cdp" | "x402.org";

export class TrackedFacilitatorClient implements FacilitatorClient {
    constructor(readonly label: FacilitatorLabel, private readonly inner: FacilitatorClient) {}

    verify(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<VerifyResponse> {
        const attempt = currentAttempt();
        if (attempt) { attempt.facilitator = this.label; }
        return this.inner.verify(paymentPayload, paymentRequirements);
    }

    settle(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<SettleResponse> {
        const attempt = currentAttempt();
        if (attempt) { attempt.facilitator = this.label; }
        return this.inner.settle(paymentPayload, paymentRequirements);
    }

    getSupported(): Promise<SupportedResponse> {
        return this.inner.getSupported();
    }
}

// ---- Final classification (called once per request by the payment middleware) ----

export interface PaymentRequestFacts {
    route: string;
    requestId: string;
    status: number;
    /** `Payment-Signature` request header (x402 v2). */
    paymentSignature: string | undefined;
    /** `X-PAYMENT` request header (x402 v1). */
    v1Payment: string | undefined;
    /** `PAYMENT-REQUIRED` response header, present on a 402. */
    paymentRequired: string | null;
    /** `PAYMENT-RESPONSE` response header, present after settlement. */
    paymentResponse: string | null;
    wallUnavailable: boolean;
    latencyMs: number;
}

/** Decode a header with an x402 decoder, or undefined when it is malformed. */
function tryDecode<T>(decode: (header: string) => T, header: string | null | undefined): T | undefined {
    if (!header) { return undefined; }
    try {
        return decode(header);
    } catch {
        return undefined;
    }
}

/** Build the single funnel event for a request that went through the payment wall. */
/**
 * The payer a payment payload claims: the EIP-3009 or Permit2 `from` on EVM,
 * the token-transfer authority on Solana. It is unverified (it comes from the
 * buyer's header), so it only attributes attempts the facilitator never
 * named a payer for, such as verify errors and pre-verify rejections.
 */
export function claimedPayer(payload: PaymentPayload | undefined): string | undefined {
    if (!payload) { return undefined; }
    const inner = payload.payload;
    if (payload.accepted.network.startsWith("solana:")) {
        const { transaction } = inner;
        if (typeof transaction !== "string") { return undefined; }
        try {
            return getTokenPayerFromTransaction(decodeTransactionFromPayload({ transaction })) || undefined;
        } catch {
            return undefined;
        }
    }
    for (const authorization of [inner.authorization, inner.permit2Authorization]) {
        if (isRecord(authorization) && typeof authorization.from === "string") { return authorization.from; }
    }
    return undefined;
}

export function classifyPaymentRequest(facts: PaymentRequestFacts, attempt: PaymentAttempt): PaymentEvent {
    const base = {
        route: facts.route,
        requestId: facts.requestId,
        latencyMs: facts.latencyMs,
        facilitator: attempt.facilitator,
        fallback: attempt.fallbacks?.join("; "),
    };
    const challenge = tryDecode(decodePaymentRequiredHeader, facts.paymentRequired);
    const quoted = challenge?.accepts[0]?.amount;
    const payload = tryDecode(decodePaymentSignatureHeader, facts.paymentSignature);

    if (facts.wallUnavailable) {
        return { ...base, outcome: "wall_unavailable", amount: quoted };
    }
    if (attempt.outcome) {
        return {
            ...base,
            outcome: attempt.outcome,
            network: attempt.network,
            scheme: attempt.scheme,
            reason: attempt.reason,
            payer: attempt.payer ?? claimedPayer(payload),
            transaction: attempt.transaction,
            amount: attempt.amount,
        };
    }
    if (!facts.paymentSignature && facts.v1Payment) {
        return { ...base, outcome: "v1_header", reason: challenge?.error, amount: quoted };
    }
    if (!facts.paymentSignature) {
        return facts.status === 402
            ? { ...base, outcome: "unpaid", amount: quoted }
            : { ...base, outcome: "unclassified", reason: `unpaid request answered ${String(facts.status)}` };
    }

    const settle = tryDecode(decodePaymentResponseHeader, facts.paymentResponse);
    if (settle?.success) {
        return {
            ...base,
            outcome: "settled",
            network: settle.network,
            scheme: payload?.accepted.scheme,
            payer: settle.payer ?? claimedPayer(payload),
            transaction: settle.transaction,
            amount: payload?.accepted.amount,
        };
    }
    if (facts.status === 402) {
        return {
            ...base,
            outcome: "rejected",
            network: payload?.accepted.network,
            scheme: payload?.accepted.scheme,
            payer: claimedPayer(payload),
            amount: payload?.accepted.amount ?? quoted,
            reason: challenge?.error ?? (payload ? undefined : "malformed Payment-Signature header"),
        };
    }
    return { ...base, outcome: "unclassified", reason: `paid request answered ${String(facts.status)} with no settlement` };
}

const LOG_LEVEL_BY_OUTCOME: Record<PaymentOutcome, keyof Pick<Logger, "debug" | "info" | "warn" | "error">> = {
    unpaid: "debug",
    v1_header: "warn",
    rejected: "warn",
    verify_rejected: "warn",
    verify_error: "error",
    settled: "info",
    settle_failed: "error",
    canceled: "warn",
    wall_unavailable: "error",
    unclassified: "warn",
};

/**
 * The one method used on the Analytics Engine binding. Declared structurally so
 * this module (whose column layout `scripts/payment-funnel.ts` imports) does not
 * depend on the Workers-only `AnalyticsEngineDataset` global type.
 */
export interface PaymentEventSink {
    writeDataPoint(point: { indexes: string[]; blobs: string[]; doubles: number[] }): void;
}

/** Write the event to Analytics Engine and the structured log. Never throws. */
export function emitPaymentEvent(dataset: PaymentEventSink, log: Logger, event: PaymentEvent): void {
    const double = (key: (typeof PAYMENT_EVENT_DOUBLES)[number]): number =>
        key === "amount" ? Number(event.amount ?? 0) : event.latencyMs;
    try {
        dataset.writeDataPoint({
            indexes: [event.route],
            blobs: PAYMENT_EVENT_BLOBS.map((key) => event[key] ?? ""),
            doubles: PAYMENT_EVENT_DOUBLES.map(double),
        });
    } catch (error) {
        log.warn("x402.telemetry_write_failed", { error: errorMessage(error) });
    }
    log[LOG_LEVEL_BY_OUTCOME[event.outcome]](`x402.${event.outcome}`, {
        route: event.route,
        network: event.network,
        scheme: event.scheme,
        facilitator: event.facilitator,
        reason: event.reason,
        payer: mask(event.payer),
        transaction: event.transaction,
        amount: event.amount,
        fallback: event.fallback,
        latencyMs: event.latencyMs,
    });
}
