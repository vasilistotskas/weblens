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

    if (!c.env.CREDIT_MANAGER) {
        return c.json(
            createErrorResponse(
                "SERVICE_UNAVAILABLE",
                "Credit service is not configured",
                requestId
            ),
            503,
        );
    }

    // Extract wallet + EIP-3009 nonce from the verified x402 payment payload.
    // The @x402/hono middleware has already validated the signature and
    // settled the transfer on-chain before this handler runs, so we can
    // trust `authorization.from` as the payer. The `authorization.nonce` is
    // unique per EIP-3009 transfer by protocol and makes a stable dedup key.
    const paymentHeader = c.req.header("Payment-Signature");
    if (!paymentHeader) {
        return c.json(
            createErrorResponse(
                "PAYMENT_FAILED",
                "Payment-Signature header required — x402 middleware should have rejected this request",
                requestId
            ),
            402,
        );
    }

    let walletAddress: string;
    let paymentNonce: string | undefined;
    try {
        const decoded = JSON.parse(atob(paymentHeader)) as {
            payload?: { authorization?: { from?: string; nonce?: string } };
        };
        const from = decoded.payload?.authorization?.from;
        if (!from || !/^0x[a-fA-F0-9]{40}$/u.test(from)) {
            return c.json(
                createErrorResponse("INVALID_REQUEST", "Malformed payment payload: missing or invalid `from`", requestId),
                400,
            );
        }
        walletAddress = from;
        paymentNonce = decoded.payload?.authorization?.nonce;
    } catch {
        return c.json(
            createErrorResponse("INVALID_REQUEST", "Malformed Payment-Signature header", requestId),
            400,
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

        // Process the deposit — use the EIP-3009 nonce as externalId so any
        // retry of this exact on-chain transfer is deduped inside the DO.
        const { account, bonusAccrued, duplicate } = await processDeposit(
            c.env.CREDIT_MANAGER,
            walletAddress,
            amountUsd,
            requestId,
            { externalId: paymentNonce ?? requestId, source: "x402" },
        );

        return c.json({
            success: true,
            duplicate,
            message: duplicate
                ? `Duplicate request — this payment was already applied. Current balance: $${account.balance.toFixed(4)}`
                : `Successfully added ${amountStr} to your account`,
            added: duplicate ? "$0.00" : amountStr,
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
