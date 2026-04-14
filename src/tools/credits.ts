/**
 * Credit Account Handlers
 *
 * Endpoints for managing agent credit accounts (Agent Prime)
 * - POST /credits/buy: Purchase credits via x402
 * - GET /credits/balance: Check balance
 * - GET /credits/history: Transaction log
 */

import type { Context } from "hono";
import { PRICING } from "../config";
import { createErrorResponse } from "../middleware/errorHandler";
import {
    processDeposit,
    getCreditAccount,
    getTransactionHistory,
} from "../services/credits";
import type { Env } from "../types";
import { generateRequestId } from "../utils/requestId";
import { verifyWalletSignature } from "../utils/security";

/**
 * POST /credits/buy
 * Buy credits with x402 payment.
 * The payment is processed by the x402 middleware (facilitator),
 * and if successful, we credit the account.
 *
 * NOTE: The actual payment verification happens in the middleware.
 * This handler assumes payment was successful if checking x402 context.
 * However, we need to know HOW MUCH was paid.
 * Currently, x402 middleware passes payment info in context or headers?
 * We'll use the LazyPaymentMiddleware approach where we define a fixed price.
 * BUT, this is a variable amount purchase!
 *
 * Strategy for MVP:
 * We use a "menu" of fixed price options or we define a specialized middleware?
 * For now, let's treat it as a specific endpoint that requires payment matching the body amount.
 * The x402 middleware will challenge for the amount.
 */
export async function buyCreditsHandler(c: Context<{ Bindings: Env }>) {
    const requestId = generateRequestId();

    // 1. Get wallet address from authenticated context (x402 v2)
    // We extract it from the Payment-Signature header passed by the client.
    // In a full implementation the middleware would attach the verified
    // wallet to c.var so we wouldn't need to re-decode the payload here.
    const paymentHeader = c.req.header("Payment-Signature");
    let walletAddress = "0x0000000000000000000000000000000000000000"; // Fallback/Test

    if (paymentHeader) {
        try {
            const decoded = JSON.parse(atob(paymentHeader)) as { payload?: { authorization?: { from?: string } } };
            if (decoded.payload?.authorization?.from) {
                walletAddress = decoded.payload.authorization.from;
            }
        } catch {
            // Ignore malformed header
        }
    }

    if (!c.env.CREDIT_MANAGER) {
        return c.json(
            {
                error: "SERVICE_UNAVAILABLE",
                code: "SERVICE_UNAVAILABLE",
                message: "Credit service is not configured",
                requestId,
            },
            503,
        );
    }

    try {
        // validateRequest middleware already parsed the body against
        // CreditsBuyRequestSchema and stored it in context. Re-reading
        // c.req.json() would consume the (already-consumed) stream.
        const parsed = c.get("validatedBody") as { amount?: number } | undefined;
        const amountUsd = parsed?.amount;
        if (typeof amountUsd !== "number" || amountUsd < 2 || amountUsd > 1000) {
            return c.json(
                createErrorResponse(
                    "INVALID_REQUEST",
                    "amount must be between $2 and $1000",
                    requestId
                ),
                400,
            );
        }
        const amountStr = `$${amountUsd.toFixed(2)}`;

        // Currently we rely on the x402 middleware to have enforced payment.
        // Since we don't have a dynamic price middleware yet, this is a placeholder.
        // In a real flow, the middleware would see this endpoint requires $X (from body)
        // and challenge appropriately.
        // For MVP, we assume the user paid the amount they claimed if they passed the
        // payment middleware check (which we will configure partially).

        // Process the deposit
        const { account, bonusAccrued } = await processDeposit(
            c.env.CREDIT_MANAGER,
            walletAddress,
            amountUsd,
            requestId,
        );

        return c.json({
            success: true,
            message: `Successfully added ${amountStr} to your account`,
            added: amountStr,
            bonus: `$${bonusAccrued.toFixed(2)}`,
            newBalance: `$${account.balance.toFixed(4)}`,
            tier: account.tier,
            requestId,
        });

    } catch (error) {
        return c.json(
            {
                error: "INTERNAL_ERROR",
                code: "INTERNAL_ERROR",
                message: error instanceof Error ? error.message : "Unknown error",
                requestId,
            },
            500,
        );
    }
}

/**
 * GET /credits/balance
 * Get current balance and tier info.
 */
export async function getBalanceHandler(c: Context<{ Bindings: Env }>) {
    const requestId = generateRequestId();

    const walletAddress = c.req.header("X-CREDIT-WALLET");
    const signature = c.req.header("X-CREDIT-SIGNATURE");
    const timestamp = c.req.header("X-CREDIT-TIMESTAMP");

    if (!walletAddress || !signature || !timestamp) {
        return c.json(createErrorResponse("INVALID_REQUEST", "Missing authentication headers", requestId), 401);
    }

    const verification = await verifyWalletSignature(walletAddress, signature, timestamp);
    if (!verification.isValid) {
        return c.json(createErrorResponse("PAYMENT_FAILED", verification.error ?? "Invalid signature", requestId), 401);
    }

    if (!c.env.CREDIT_MANAGER) {
        return c.json(createErrorResponse("SERVICE_UNAVAILABLE", "Credit service is not configured", requestId), 503);
    }

    const account = await getCreditAccount(c.env.CREDIT_MANAGER, walletAddress);

    if (!account) {
        return c.json({
            balance: "$0.00",
            tier: "standard",
            totalDeposited: "$0.00",
            nextTier: PRICING.credits.tiers[0],
            requestId,
        });
    }

    return c.json({
        balance: `$${account.balance.toFixed(4)}`,
        tier: account.tier,
        totalDeposited: `$${account.totalDeposited.toFixed(2)}`,
        totalSpent: `$${account.totalSpent.toFixed(2)}`,
        requestId,
    });
}

/**
 * GET /credits/history
 * Get transaction history.
 */
export async function getHistoryHandler(c: Context<{ Bindings: Env }>) {
    const requestId = generateRequestId();

    const walletAddress = c.req.header("X-CREDIT-WALLET");
    const signature = c.req.header("X-CREDIT-SIGNATURE");
    const timestamp = c.req.header("X-CREDIT-TIMESTAMP");

    if (!walletAddress || !signature || !timestamp) {
        return c.json(createErrorResponse("INVALID_REQUEST", "Missing authentication headers", requestId), 401);
    }

    const verification = await verifyWalletSignature(walletAddress, signature, timestamp);
    if (!verification.isValid) {
        return c.json(createErrorResponse("PAYMENT_FAILED", verification.error ?? "Invalid signature", requestId), 401);
    }

    if (!c.env.CREDIT_MANAGER) {
        return c.json(createErrorResponse("SERVICE_UNAVAILABLE", "Credit service is not configured", requestId), 503);
    }

    const history = await getTransactionHistory(c.env.CREDIT_MANAGER, walletAddress);

    return c.json({
        history: history.map(tx => ({
            ...tx,
            formattedAmount: `$${Math.abs(tx.amount).toFixed(4)}`,
        })),
        requestId,
    });
}
