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
import type { Env, ErrorCode } from "../types";
import { verifyWalletSignature } from "../utils/security";

/** Headers a caller must send to reach a wallet-scoped credits endpoint. */
const CREDIT_AUTH_HEADERS = ["X-CREDIT-WALLET", "X-CREDIT-SIGNATURE", "X-CREDIT-TIMESTAMP"] as const;

type WalletAuth =
    | { ok: true; wallet: string }
    | { ok: false; code: ErrorCode; message: string };

/**
 * Authenticate a wallet-scoped credits request.
 *
 * Shared by /credits/balance and /credits/history, which had identical copies.
 * Two things they both got wrong: the failure was reported as INVALID_REQUEST
 * (a 400 code) on a 401 response, and the precise code `verifyWalletSignature`
 * already computes — expired timestamp, malformed address, bad signature — was
 * discarded in favour of a blanket PAYMENT_FAILED.
 *
 * The message names the missing headers and the exact string to sign: ~2.1k
 * callers a week reach these endpoints unauthenticated, and "Missing
 * authentication headers" named none of them.
 */
async function authenticateWallet(c: Context<{ Bindings: Env }>): Promise<WalletAuth> {
    const missing = CREDIT_AUTH_HEADERS.filter((header) => !c.req.header(header));
    if (missing.length > 0) {
        return {
            ok: false,
            code: "MISSING_AUTH",
            message:
                `Missing required header${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. ` +
                "Send your address in X-CREDIT-WALLET, the current time in milliseconds in " +
                "X-CREDIT-TIMESTAMP, and in X-CREDIT-SIGNATURE an EIP-191 signature over " +
                "\"WebLens Authentication\\nWallet: <address>\\nTimestamp: <same milliseconds>\". " +
                "The timestamp may be up to 5 minutes old.",
        };
    }

    const wallet = c.req.header("X-CREDIT-WALLET") ?? "";
    const verification = await verifyWalletSignature(
        wallet,
        c.req.header("X-CREDIT-SIGNATURE") ?? "",
        c.req.header("X-CREDIT-TIMESTAMP") ?? "",
    );
    if (!verification.isValid) {
        return {
            ok: false,
            code: verification.code ?? "AUTH_FAILED",
            message: verification.error ?? "Wallet signature verification failed",
        };
    }

    return { ok: true, wallet };
}

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
    const requestId = c.get("requestId");

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
    const requestId = c.get("requestId");

    const auth = await authenticateWallet(c);
    if (!auth.ok) {
        return c.json(createErrorResponse(auth.code, auth.message, requestId), 401);
    }
    const walletAddress = auth.wallet;

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
    const requestId = c.get("requestId");

    const auth = await authenticateWallet(c);
    if (!auth.ok) {
        return c.json(createErrorResponse(auth.code, auth.message, requestId), 401);
    }
    const walletAddress = auth.wallet;

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
