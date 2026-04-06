/**
 * Credit Middleware
 *
 * Intercepts requests with X-CREDIT-WALLET header.
 * Checks for sufficient balance in CREDITS KV.
 * If balance exists, debits account and marks request as paid (bypassing x402).
 * If balance is insufficient or header missing, falls through to standard x402 flow.
 */

import type { Context, MiddlewareHandler } from "hono";
import { deductCredits } from "../services/credits";
import type { Env } from "../types";
import { generateRequestId } from "../utils/requestId";
import { verifyWalletSignature } from "../utils/security";

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
            console.warn(`[Credits] Security Warning: ${verification.error} for wallet ${creditWallet}`);
            return c.json({
                error: verification.code ?? "AUTH_FAILED",
                message: verification.error ?? "Authentication failed"
            }, 401);
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

            console.log(`[Credits] Debited ${costStr} from ${creditWallet} for ${description}`);

            await next();

            // Custom response headers indicating that the request was paid
            // via a prepaid credit account rather than per-request x402.
            c.header("Payment-Method", "Credits");
            c.header("Credit-Cost", costStr);

        } catch (error) {
            if (debited) {
                // Debit succeeded but handler failed — do not call next() again
                throw error;
            }
            // Insufficient funds or debit error — fall through to standard payment (x402)
            console.warn(`[Credits] Failed to debit: ${error instanceof Error ? error.message : "Unknown"}`);
            await next();
        }
    };
}
