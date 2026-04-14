/**
 * Fiat Credit Deposit (Stripe-backed)
 *
 * Lets an agent developer buy prepaid WebLens credits with a card — bypassing
 * x402 entirely for first-time users who don't hold USDC on Base. The flow:
 *
 *   1. POST /credits/deposit/fiat { amount, wallet } → returns Stripe Checkout URL
 *   2. User pays card → Stripe fires `checkout.session.completed` webhook
 *   3. POST /credits/webhook/stripe verifies signature + calls processDeposit(wallet)
 *   4. Agent then signs x402 requests from `wallet`; credit middleware debits
 *      transparently (same code path as USDC-funded credits).
 *
 * This is the biggest single conversion lever per April 2026 research — turns
 * a 10-minute wallet setup into a 60-second card checkout.
 */

import type { Context } from "hono";
import { createErrorResponse } from "../middleware/errorHandler";
import { processDeposit } from "../services/credits";
import type { StripeWebhookEvent } from "../services/stripe";
import { createCheckoutSession, verifyStripeSignature } from "../services/stripe";
import type { Env } from "../types";
import { generateRequestId } from "../utils/requestId";

export async function createFiatCheckoutHandler(c: Context<{ Bindings: Env }>) {
    const requestId = generateRequestId();

    if (!c.env.STRIPE_SECRET_KEY) {
        return c.json(
            createErrorResponse(
                "SERVICE_UNAVAILABLE",
                "Fiat deposits are not configured. Set STRIPE_SECRET_KEY via wrangler secret.",
                requestId
            ),
            503
        );
    }

    const body = c.get("validatedBody") as { amount: number; wallet: string } | undefined;
    if (!body) {
        return c.json(
            createErrorResponse("INVALID_REQUEST", "Missing validated body", requestId),
            400
        );
    }

    const baseUrl = new URL(c.req.url).origin;
    const successUrl =
        c.env.STRIPE_SUCCESS_URL ?? `${baseUrl}/credits/fiat/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = c.env.STRIPE_CANCEL_URL ?? `${baseUrl}/credits/fiat/cancel`;

    try {
        const session = await createCheckoutSession({
            secretKey: c.env.STRIPE_SECRET_KEY,
            amountUsd: body.amount,
            wallet: body.wallet,
            successUrl,
            cancelUrl,
        });

        return c.json({
            checkoutUrl: session.url,
            sessionId: session.id,
            amount: `$${body.amount.toFixed(2)}`,
            wallet: body.wallet,
            message:
                "Open checkoutUrl in a browser to pay. Credits will be applied to your wallet once Stripe confirms the payment (usually < 30s).",
            requestId,
        });
    } catch (err) {
        console.error("[fiat-deposit] checkout session creation failed:", err);
        return c.json(
            createErrorResponse(
                "INTERNAL_ERROR",
                err instanceof Error ? err.message : "Stripe checkout failed",
                requestId
            ),
            500
        );
    }
}

export async function stripeWebhookHandler(c: Context<{ Bindings: Env }>) {
    const requestId = generateRequestId();

    if (!c.env.STRIPE_WEBHOOK_SECRET || !c.env.CREDIT_MANAGER) {
        return c.json(
            createErrorResponse(
                "SERVICE_UNAVAILABLE",
                "Stripe webhook not configured",
                requestId
            ),
            503
        );
    }

    // Signature verification requires the *raw* body, so read it as text before
    // any JSON parse. Hono's c.req.text() returns the untouched body string.
    const rawBody = await c.req.text();
    const signature = c.req.header("stripe-signature") ?? null;

    const verification = await verifyStripeSignature({
        secret: c.env.STRIPE_WEBHOOK_SECRET,
        payload: rawBody,
        header: signature,
    });

    if (!verification.valid) {
        console.error("[stripe-webhook] signature verification failed:", verification.reason);
        // 400 (not 401) — Stripe treats any non-2xx/5xx as permanent failure,
        // and 400 matches the "malformed webhook" semantics better than 401
        // (which implies the caller could re-authenticate).
        return c.json(
            createErrorResponse("INVALID_REQUEST", `Signature verification failed: ${verification.reason ?? "unknown"}`, requestId),
            400
        );
    }

    let event: StripeWebhookEvent;
    try {
        event = JSON.parse(rawBody) as StripeWebhookEvent;
    } catch {
        return c.json(createErrorResponse("INVALID_REQUEST", "Malformed webhook body", requestId), 400);
    }

    // Fast-path dedup via KV on event.id (Stripe guarantees event.id is
    // stable across retries). This short-circuits before hitting the DO so
    // replayed events don't even do the round-trip.
    if (c.env.CACHE) {
        const dedupKey = `stripe:event:${event.id}`;
        try {
            const seen = await c.env.CACHE.get(dedupKey);
            if (seen !== null) {
                return c.json({ received: true, duplicate: true, event: event.id, requestId });
            }
        } catch { /* KV unavailable; fall through to DO-level dedup */ }
    }

    // Only react to completed checkout sessions. Other events (payment_intent.*,
    // charge.*) are acked with 200 so Stripe stops retrying.
    if (event.type !== "checkout.session.completed") {
        return c.json({ received: true, event: event.type, requestId });
    }

    const session = event.data.object;
    if (session.payment_status !== "paid") {
        console.log(`[stripe-webhook] session ${session.id ?? "?"} not paid (status=${session.payment_status ?? "?"})`);
        return c.json({ received: true, skipped: "not paid", requestId });
    }

    const wallet = session.metadata?.wallet;
    const amountUsdStr = session.metadata?.amountUsd;
    if (!wallet || !amountUsdStr) {
        console.error(`[stripe-webhook] session ${session.id ?? "?"} missing wallet/amount metadata`);
        return c.json(createErrorResponse("INVALID_REQUEST", "Missing wallet/amount metadata", requestId), 400);
    }

    const amountUsd = parseFloat(amountUsdStr);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
        return c.json(createErrorResponse("INVALID_REQUEST", "Invalid amount metadata", requestId), 400);
    }

    // Cross-check against the authoritative settled amount Stripe reports.
    // Defends against a future refactor that makes metadata drift from the
    // actual charge — the card-facing `amount_total` is the ground truth.
    const expectedCents = Math.round(amountUsd * 100);
    if (
        typeof session.amount_total === "number" &&
        session.amount_total !== expectedCents
    ) {
        console.error(
            `[stripe-webhook] amount mismatch: metadata=${String(expectedCents)}c, amount_total=${String(session.amount_total)}c, session=${session.id ?? "?"}`
        );
        return c.json(
            createErrorResponse("INVALID_REQUEST", "Amount mismatch between metadata and settled charge", requestId),
            400
        );
    }

    try {
        const { account, bonusAccrued, duplicate } = await processDeposit(
            c.env.CREDIT_MANAGER,
            wallet,
            amountUsd,
            session.id ?? event.id,
            { externalId: event.id, source: "stripe" }
        );

        // Mark event as processed in KV (24h TTL covers Stripe's 72h retry
        // with headroom; DO-level dedup remains the source of truth).
        if (c.env.CACHE) {
            try {
                await c.env.CACHE.put(`stripe:event:${event.id}`, "1", { expirationTtl: 86400 });
            } catch { /* non-fatal */ }
        }

        console.log(
            `[stripe-webhook] ${duplicate ? "duplicate ignored" : "credited"} $${amountUsd.toFixed(2)} (+ $${bonusAccrued.toFixed(2)} bonus) to ${wallet}; balance $${account.balance.toFixed(4)}`
        );
        return c.json({
            received: true,
            duplicate,
            wallet,
            credited: duplicate ? "$0.00" : `$${amountUsd.toFixed(2)}`,
            bonus: `$${bonusAccrued.toFixed(2)}`,
            newBalance: `$${account.balance.toFixed(4)}`,
            requestId,
        });
    } catch (err) {
        console.error(`[stripe-webhook] deposit failed for ${wallet}:`, err);
        // Return 500 so Stripe retries. Idempotency is now enforced inside
        // the Durable Object via externalId dedup, so a retry on the same
        // event.id returns duplicate=true instead of double-crediting.
        return c.json(
            createErrorResponse("INTERNAL_ERROR", err instanceof Error ? err.message : "Deposit failed", requestId),
            500
        );
    }
}
