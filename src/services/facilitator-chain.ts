/**
 * Facilitators for one network family, tried in order.
 *
 * x402ResourceServer assigns each (scheme, network) to ONE facilitator at
 * initialize() and never retries elsewhere. A chain is that one facilitator:
 * it advertises its family's kinds from the first facilitator that answers
 * /supported, and verifies and settles through each facilitator in turn until
 * one succeeds.
 *
 * Falling back is only sound where the payment requirements do not depend on
 * which facilitator quoted them. For EVM `exact` they do not (both CDP and
 * PayAI advertise it with an empty `extra`, and ExactEvmScheme ignores the
 * supported kind), and an EIP-3009 or Permit2 nonce can be spent once, so a
 * second settle of the same authorization cannot charge the buyer twice. On
 * Solana the requirement carries the quoting facilitator's own fee payer, so a
 * Solana chain must hold exactly one facilitator (see parseFacilitatorOrder).
 */

import type { FacilitatorClient } from "@x402/core/server";
import type {
    PaymentPayload,
    PaymentRequirements,
    SettleResponse,
    SupportedResponse,
    VerifyResponse,
} from "@x402/core/types";
import { errorMessage } from "../utils/logger";
import type { Logger } from "../utils/logger";
import { noteFallback as recordFallback } from "./payment-telemetry";
import type { FacilitatorLabel, TrackedFacilitatorClient } from "./payment-telemetry";

/** CAIP-2 namespaces WebLens takes payments in. */
export type NetworkFamily = "eip155" | "solana";

const FACILITATOR_LABELS: readonly FacilitatorLabel[] = ["cdp", "payai", "x402.org"];

function isFacilitatorLabel(value: string): value is FacilitatorLabel {
    return (FACILITATOR_LABELS as readonly string[]).includes(value);
}

/**
 * Parse a comma-separated facilitator order (`FACILITATORS_EVM` /
 * `FACILITATORS_SVM`). Throws on an empty list, an unknown name, a repeat, or
 * more than one Solana facilitator, so a bad config fails the payment wall
 * loudly instead of settling somewhere unintended.
 */
export function parseFacilitatorOrder(family: NetworkFamily, value: string | undefined): [FacilitatorLabel, ...FacilitatorLabel[]] {
    const names = (value ?? "").split(",").map((name) => name.trim()).filter(Boolean);
    const unknown = names.filter((name) => !isFacilitatorLabel(name));
    if (unknown.length > 0) {
        throw new Error(`Unknown ${family} facilitator(s): ${unknown.join(", ")}`);
    }
    const [first, ...rest] = names.filter(isFacilitatorLabel);
    if (first === undefined) {
        throw new Error(`No facilitators configured for ${family}`);
    }
    if (new Set(names).size !== names.length) {
        throw new Error(`A ${family} facilitator is listed twice: ${names.join(", ")}`);
    }
    if (family === "solana" && rest.length > 0) {
        throw new Error("Solana payments are quoted with one facilitator's fee payer, so only one Solana facilitator can be configured");
    }
    return [first, ...rest];
}

function inFamily(network: string, family: NetworkFamily): boolean {
    return network.startsWith(`${family}:`);
}

export class FacilitatorChain implements FacilitatorClient {
    constructor(
        readonly family: NetworkFamily,
        private readonly facilitators: readonly [TrackedFacilitatorClient, ...TrackedFacilitatorClient[]],
        private readonly log: Logger,
    ) {}

    /** Labels in the order they are tried. */
    get labels(): FacilitatorLabel[] {
        return this.facilitators.map((facilitator) => facilitator.label);
    }

    /** The family's kinds as the first facilitator that answers advertises them. */
    async getSupported(): Promise<SupportedResponse> {
        let failure: unknown;
        for (const facilitator of this.facilitators) {
            try {
                const supported = await facilitator.getSupported();
                return { ...supported, kinds: supported.kinds.filter((kind) => inFamily(kind.network, this.family)) };
            } catch (error) {
                failure = error;
                this.log.warn("facilitator.supported_failed", { family: this.family, facilitator: facilitator.label, reason: errorMessage(error) });
            }
        }
        throw failure;
    }

    /**
     * The first facilitator that finds the payment valid answers. When none
     * does, the first rejection is returned (a reason about the payment
     * itself); only when every facilitator failed outright is the last error
     * thrown.
     */
    async verify(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<VerifyResponse> {
        let rejection: VerifyResponse | undefined;
        let failure: unknown;
        for (const facilitator of this.facilitators) {
            try {
                const result = await facilitator.verify(paymentPayload, paymentRequirements);
                if (result.isValid) { return result; }
                rejection ??= result;
                this.noteFallback("verify", facilitator, result.invalidReason ?? "invalid");
            } catch (error) {
                failure = error;
                this.noteFallback("verify", facilitator, errorMessage(error));
            }
        }
        if (rejection) { return rejection; }
        throw failure;
    }

    /**
     * The first facilitator that settles answers. When none does, the last
     * facilitator's outcome is returned or thrown: it is the latest word on
     * whether the authorization was spent.
     */
    async settle(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<SettleResponse> {
        let failed: SettleResponse | undefined;
        let failure: unknown;
        for (const facilitator of this.facilitators) {
            try {
                const result = await facilitator.settle(paymentPayload, paymentRequirements);
                if (result.success) { return result; }
                [failed, failure] = [result, undefined];
                this.noteFallback("settle", facilitator, result.errorReason ?? "failed");
            } catch (error) {
                [failed, failure] = [undefined, error];
                this.noteFallback("settle", facilitator, errorMessage(error));
            }
        }
        if (failed) { return failed; }
        throw failure;
    }

    private noteFallback(operation: "verify" | "settle", facilitator: TrackedFacilitatorClient, reason: string): void {
        const index = this.facilitators.indexOf(facilitator);
        const next = this.facilitators[index + 1];
        // A handover goes into the request's funnel event, which is never
        // sampled; the log line below is (Workers Logs keep ~10% in production).
        if (next) { recordFallback(operation, facilitator.label, reason); }
        this.log.warn(next ? "facilitator.fallback" : "facilitator.exhausted", {
            operation,
            family: this.family,
            facilitator: facilitator.label,
            ...(next ? { next: next.label } : {}),
            reason,
        });
    }
}
