/**
 * Credit Middleware
 *
 * Intercepts requests with X-CREDIT-WALLET header.
 * Verifies the wallet signature, then debits the CreditAccountDO balance and
 * marks the request as paid (bypassing x402).
 * If balance is insufficient or header missing, falls through to standard x402 flow.
 *
 * Refund semantics: handlers report failures by *returning* JSON error
 * envelopes (they catch their own errors), not by throwing. So a debit is
 * refunded both when `next()` throws AND when the final response status is
 * an error (>= 400) — otherwise credit users would be charged for timeouts,
 * provider failures, and other requests that delivered nothing.
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
    cost: string | ((c: Context) => string | Promise<string>),
    description: string,
): MiddlewareHandler<{ Bindings: Env }> {
    return async (c, next) => {
        const creditWallet = c.req.header("X-CREDIT-WALLET");
        const signature = c.req.header("X-CREDIT-SIGNATURE");
        const timestamp = c.req.header("X-CREDIT-TIMESTAMP");

        // No credit wallet → not a credit-paid request, fall through to x402.
        const creditManager = c.env.CREDIT_MANAGER;
        if (!creditWallet || !creditManager) {
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
        const costStr = typeof cost === "function" ? await cost(c) : cost;
        const amountUsd = parseFloat(costStr.replace("$", ""));

        // Refund a completed debit. Idempotent via the `refund:` externalId,
        // so the throw path and the error-status path can never double-refund.
        const refundDebit = async (reason: string): Promise<void> => {
            try {
                await refundCredits(
                    creditManager,
                    creditWallet,
                    amountUsd,
                    `Refund: ${reason} for ${description}`,
                    `refund:${requestId}`,
                );
                getLog(c).warn("credit.refund", {
                    wallet: mask(creditWallet),
                    cost: costStr,
                    requestId,
                    reason,
                    description,
                });
            } catch (refundErr) {
                // Refund itself failed — log but never mask the original failure.
                // Operator action required: inspect /credits/history for the wallet.
                getLog(c).error("credit.refund_failed", {
                    wallet: mask(creditWallet),
                    cost: costStr,
                    requestId,
                    error: refundErr instanceof Error ? refundErr.message : String(refundErr),
                });
            }
        };

        let debited = false;
        try {
            // Attempt to debit credits
            await deductCredits(
                creditManager,
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

            // Handlers catch their own errors and *return* JSON envelopes,
            // so a resolved next() is not proof of success — check the
            // status. Any error response means the caller got no data and
            // must not be charged.
            if (c.res.status >= 400) {
                await refundDebit("error_response");
                c.header("Payment-Method", "Credits");
                c.header("Credit-Refunded", costStr);
            } else {
                // Custom response headers indicating that the request was paid
                // via a prepaid credit account rather than per-request x402.
                c.header("Payment-Method", "Credits");
                c.header("Credit-Cost", costStr);
            }

        } catch (error) {
            if (debited) {
                // Debit succeeded but the handler threw — refund, then let
                // the global error handler render the envelope.
                await refundDebit("handler_failure");
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
