/**
 * Credit Middleware
 *
 * Intercepts requests with X-CREDIT-WALLET header.
 * Checks for sufficient balance in CREDITS KV.
 * If balance exists, debits account and marks request as paid (bypassing x402).
 * If balance is insufficient or header missing, falls through to standard x402 flow.
 */

import type { Context, MiddlewareHandler } from "hono";
import { deductCredits, refundCredits } from "../services/credits";
import { hashContent } from "../services/crypto";
import type { Env } from "../types";
import type { Logger } from "../utils/logger";
import { mask } from "../utils/logger";
import { generateRequestId } from "../utils/requestId";
import { verifyWalletSignature } from "../utils/security";

// The request-scoped logger is always set by requestId middleware (global
// `app.use("*")`), so handlers/middleware can read it directly.
function getLog(c: Context): Logger {
    return c.get("log");
}

/**
 * Create credit payment middleware.
 * @param cost Function to determine cost of request (or fixed string)
 * @param description Description of what is being paid for
 */
export function createCreditMiddleware(
    cost: string | ((c: Context) => string),
    description: string,
): MiddlewareHandler<{ Bindings: Env }> {
    return async (c, next) => {
        const creditWallet = c.req.header("X-CREDIT-WALLET");
        const signature = c.req.header("X-CREDIT-SIGNATURE");
        const timestamp = c.req.header("X-CREDIT-TIMESTAMP");

        // No credit wallet → not a credit-paid request, fall through to x402.
        if (!creditWallet || !c.env.CREDIT_MANAGER) {
            await next(); return;
        }

        // Half-configured credit headers (wallet present but signature or
        // timestamp missing) are NOT a hard error — fall through to x402 so
        // the buyer still has a path to pay. A buggy client that sets the
        // wallet header without the signature pair should not be permanently
        // locked out of the API.
        if (!signature || !timestamp) {
            await next(); return;
        }

        // Wallet + signature + timestamp all present → verify the signature.
        // If verification FAILS we return 401 because at this point the
        // client is intentionally claiming to be a credit user with a
        // forged/expired signature, which is an auth failure, not a missing
        // header.
        const verification = await verifyWalletSignature(creditWallet, signature, timestamp);

        if (!verification.isValid) {
            getLog(c).warn("credit.auth_failed", {
                wallet: mask(creditWallet),
                code: verification.code,
                reason: verification.error,
            });
            return c.json({
                error: verification.code ?? "AUTH_FAILED",
                message: verification.error ?? "Authentication failed"
            }, 401);
        }

        // Replay protection: the signature is valid for up to the 5-minute
        // timestamp window. Reject any (wallet+timestamp+signature) tuple we've
        // already seen within that window so a leaked header can't be replayed.
        const replayKv = c.env.CACHE;
        if (replayKv) {
            const nonceKey = `sigreplay:${await hashContent(signature)}`;
            const alreadyUsed = await replayKv.get(nonceKey);
            if (alreadyUsed) {
                getLog(c).warn("credit.replay_rejected", { wallet: mask(creditWallet) });
                return c.json(
                    { error: "REPLAY_DETECTED", message: "This signature has already been used" },
                    401,
                );
            }
            // TTL just past the 5-min signature window so the marker outlives validity.
            await replayKv.put(nonceKey, "1", { expirationTtl: 360 });
        }

        const requestId = c.get("requestId") || generateRequestId();
        const costStr = typeof cost === "function" ? cost(c) : cost;
        const amountUsd = parseFloat(costStr.replace("$", ""));

        let debited = false;
        try {
            // Attempt to debit credits
            await deductCredits(
                c.env.CREDIT_MANAGER,
                creditWallet,
                amountUsd,
                description,
                requestId,
            );

            debited = true;

            // Mark as paid
            c.set("paidWithCredits", true);
            c.set("creditWallet", creditWallet);

            getLog(c).info("credit.debit", {
                wallet: mask(creditWallet),
                cost: costStr,
                description,
                requestId,
            });

            await next();

            // Custom response headers indicating that the request was paid
            // via a prepaid credit account rather than per-request x402.
            c.header("Payment-Method", "Credits");
            c.header("Credit-Cost", costStr);

        } catch (error) {
            if (debited) {
                // Debit succeeded but handler failed — refund the debit so
                // the user isn't charged for data they didn't receive. The
                // refund is itself idempotent via externalId, so if this
                // path is somehow retried the second refund is a no-op.
                try {
                    await refundCredits(
                        c.env.CREDIT_MANAGER,
                        creditWallet,
                        amountUsd,
                        `Refund: handler failure for ${description}`,
                        `refund:${requestId}`,
                    );
                    getLog(c).warn("credit.refund", {
                        wallet: mask(creditWallet),
                        cost: costStr,
                        requestId,
                        reason: "handler_failure",
                        description,
                    });
                } catch (refundErr) {
                    // Refund itself failed — log but still propagate the original error.
                    // Operator action required: inspect /credits/history for the wallet.
                    getLog(c).error("credit.refund_failed", {
                        wallet: mask(creditWallet),
                        cost: costStr,
                        requestId,
                        error: refundErr instanceof Error ? refundErr.message : String(refundErr),
                    });
                }
                throw error;
            }
            // Insufficient funds or debit error — fall through to standard payment (x402)
            getLog(c).warn("credit.debit_failed", {
                wallet: mask(creditWallet),
                error: error instanceof Error ? error.message : "Unknown",
            });
            await next();
        }
    };
}
