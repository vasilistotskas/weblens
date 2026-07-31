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

import type { MiddlewareHandler } from "hono";
import { PAID_ENDPOINTS } from "../config";
import { recordReceipt } from "../services/erc8004";
import type { Env, Variables } from "../types";

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
            const receipt = await recordReceipt(c.env, {
                requestId,
                endpoint: path,
                method: c.req.method,
                status,
                outcome: "success",
                price: c.res.headers.get("Credit-Cost") ?? undefined,
                currency: "USD",
                paymentMethod: paidWithCredits ? "credits" : "x402",
                network: c.env.NETWORK ?? "base",
                payTo: c.env.PAY_TO_ADDRESS,
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
