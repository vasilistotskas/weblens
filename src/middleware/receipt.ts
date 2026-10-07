/**
 * Receipt middleware.
 *
 * After a *paid* call succeeds, persist an ERC-8004-citable receipt and point
 * the caller at it with response headers. Buyers use it as `proofOfPayment`
 * evidence in the feedback document they post to the Reputation Registry.
 *
 * Deliberately narrow: only calls that actually carried payment produce a
 * receipt, so unauthenticated probes cannot fill KV. Never fails a request —
 * a receipt is an add-on to a call the buyer already paid for.
 */

import { decodePaymentResponseHeader, decodePaymentSignatureHeader } from "@x402/core/http";
import type { MiddlewareHandler } from "hono";
import { PAID_ENDPOINTS } from "../config";
import { recordReceipt } from "../services/erc8004";
import type { CallReceipt } from "../services/erc8004";
import type { Env, Variables } from "../types";

/** USDC uses 6 decimals on every chain WebLens accepts (Base and Solana). */
const USDC_DECIMALS = 6;

/** Atomic USDC units -> "$0.015". */
function formatUsdc(atomic: string): string {
    const units = BigInt(atomic);
    const scale = 10n ** BigInt(USDC_DECIMALS);
    const fraction = (units % scale).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/u, "");
    return `$${(units / scale).toString()}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Describe what an x402 call actually settled, for the receipt.
 *
 * Network, transaction and payer come from `PAYMENT-RESPONSE` — the
 * facilitator's settle result, which `@x402/hono` attaches only after a
 * successful settlement. Price and payTo come from the requirement the buyer
 * accepted in `Payment-Signature`; the server only settles a payload whose
 * `accepted` matches one of its own requirements. Reading these from env
 * instead stamped a Solana payment as "base" with the EVM payout address.
 */
function settledX402Payment(
    signatureHeader: string | undefined,
    responseHeader: string | null,
): Pick<CallReceipt, "price" | "network" | "payTo" | "transaction" | "payer"> | null {
    if (!signatureHeader || !responseHeader) { return null; }
    try {
        const settled = decodePaymentResponseHeader(responseHeader);
        if (!settled.success) { return null; }
        const { accepted } = decodePaymentSignatureHeader(signatureHeader);
        return {
            price: formatUsdc(accepted.amount),
            network: settled.network,
            payTo: accepted.payTo,
            transaction: settled.transaction,
            payer: settled.payer,
        };
    } catch {
        return null;
    }
}

export function receiptMiddleware(): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
    return async (c, next) => {
        await next();

        const path = c.req.path;
        if (!PAID_ENDPOINTS.includes(path)) { return; }

        // Only a call that carried payment gets a receipt.
        const paidWithCredits = c.get("paidWithCredits") === true;
        const paidWithX402 = c.req.header("Payment-Signature") !== undefined;
        if (!paidWithCredits && !paidWithX402) { return; }

        const status = c.res.status;
        if (status >= 400) { return; } // refunded or failed — nothing was sold

        const requestId = c.get("requestId");
        if (!requestId) { return; }

        try {
            const payment = paidWithCredits
                ? { price: c.res.headers.get("Credit-Cost") ?? undefined }
                : settledX402Payment(c.req.header("Payment-Signature"), c.res.headers.get("PAYMENT-RESPONSE"));
            // An x402 call with no settlement to cite sold nothing — no receipt.
            if (!payment) { return; }

            const receipt = await recordReceipt(c.env, {
                requestId,
                endpoint: path,
                method: c.req.method,
                status,
                outcome: "success",
                currency: "USD",
                paymentMethod: paidWithCredits ? "credits" : "x402",
                ...payment,
                servedAt: new Date().toISOString(),
            });
            if (receipt) {
                const baseUrl = new URL(c.req.url).origin;
                c.res.headers.set("X-Receipt-Id", requestId);
                c.res.headers.set("X-Receipt-Url", `${baseUrl}/receipts/${requestId}`);
            }
        } catch (e) {
            c.get("log").warn("receipt.write_failed", {
                requestId,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    };
}
