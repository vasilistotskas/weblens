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

// Extend Hono Context to include payment information
declare module "hono" {
    interface ContextVariableMap {
        paidWithCredits?: boolean;
        creditWallet?: string;
        requestId?: string;
    }
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

        // If no credit wallet provided, proceed to next middleware (standard x402)
        if (!creditWallet || !c.env.CREDITS) {
            await next(); return;
        }

        // Security: Enforce signature verification
        // creditWallet is string | undefined from c.req.header
        if (!creditWallet || !signature || !timestamp) {
            return c.json({ error: "MISSING_AUTH", message: "Missing authentication headers" }, 401);
        }

        const verification = await verifyWalletSignature(creditWallet, signature, timestamp);

        if (!verification.isValid) {
            console.warn(`[Credits] Security Warning: ${verification.error} for wallet ${creditWallet}`);
            return c.json({
                error: verification.code ?? "AUTH_FAILED",
                message: verification.error ?? "Authentication failed"
            }, 401);
        }

        const requestId = c.get("requestId") ?? generateRequestId();
        const costStr = typeof cost === "function" ? cost(c) : cost;
        const amountUsd = parseFloat(costStr.replace("$", ""));

        try {
            // Attempt to debit credits
            await deductCredits(
                c.env.CREDITS,
                creditWallet,
                amountUsd,
                description,
                requestId,
            );

            // Mark as paid
            c.set("paidWithCredits", true);
            c.set("creditWallet", creditWallet);

            console.log(`[Credits] Debited ${costStr} from ${creditWallet} for ${description}`);

            await next();

            // Add a header to response indicating credit payment
            c.header("X-Payment-Method", "Credits");
            c.header("X-Credit-Cost", costStr);

        } catch (error) {
            // Insufficient funds or error
            console.warn(`[Credits] Failed to debit: ${error instanceof Error ? error.message : "Unknown"}`);
            // Fall through to standard payment (x402)
            await next();
        }
    };
}
