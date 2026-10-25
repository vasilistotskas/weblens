/**
 * Buying prepaid credit by card, and the account a key opens.
 *
 *   POST /billing/checkout {pack}   → a Stripe Checkout URL (Managed Payments). With an API key in
 *                                     Authorization it tops that account up; without one it opens a
 *                                     new account.
 *   GET  /billing/success           → Stripe's redirect after payment: fulfils the session and, the
 *                                     first time for a new account, shows its API key once.
 *   POST /billing/webhook           → Stripe's events: fulfils the same session (idempotent), and takes
 *                                     the credit back when the payment is refunded or disputed.
 *   GET  /account                   → balance and recent ledger, for the key's holder.
 *   POST /account/key/rotate        → replaces the key; the old one stops working at once.
 *
 * No sign-up form and no password: the key is the account's only credential.
 * A lost key is recovered through support in v1 (the buyer's Stripe receipt
 * names the Checkout Session).
 */

import type { Context } from "hono";
import { html } from "hono/html";
import type { z } from "zod";
import { cardPaymentsEnabled, packPrice } from "../config";
import { createErrorResponse } from "../middleware/errorHandler";
import type { CheckoutRequestSchema } from "../schemas";
import { accountStub, formatApiKey, fulfillCheckout, newAccountId, parseApiKey, reverseCheckout } from "../services/accounts";
import { formatMicros } from "../services/pricing";
import { createCheckoutSession, ForeignCheckoutError, paymentReversal, stripeEvent, verifyStripeSignature } from "../services/stripe";
import type { AppEnv } from "../types";
import { htmlPage } from "../utils/html-page";
import { str } from "../utils/narrow";

/** Stripe Checkout Session ids look like cs_test_… / cs_live_…. */
const SESSION_ID = /^cs_(?:test|live)_[A-Za-z0-9]+$/u;

/** The Stripe events that mean a Checkout Session may now be paid (docs.stripe.com/checkout/fulfillment). */
const FULFIL_EVENTS: ReadonlySet<string> = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);

/** Billing pages carry a session id or a key: never cache them. */
function noStore(c: Context<AppEnv>): void {
    c.header("Cache-Control", "no-store");
}

function stripeUnavailable(c: Context<AppEnv>) {
    return c.json(createErrorResponse("SERVICE_UNAVAILABLE", "Card payments are not configured here yet.", c.get("requestId")), 503);
}

export async function checkoutHandler(c: Context<AppEnv>) {
    const requestId = c.get("requestId");
    const secretKey = c.env.STRIPE_SECRET_KEY;
    if (!secretKey || !cardPaymentsEnabled(c.env)) { return stripeUnavailable(c); }
    const { pack } = c.get("validatedBody") as z.infer<typeof CheckoutRequestSchema>;

    // A key tops up its own account; it has to be a live key, so a typo never opens a second account.
    const key = parseApiKey(c.req.header("Authorization"), c.env.API_KEY_PREFIX);
    let accountId: string;
    if (key === "none") {
        accountId = newAccountId();
    } else if (key === "invalid" || !(await accountStub(c.env, key.accountId).summary(key.secret))) {
        return c.json(createErrorResponse("INVALID_API_KEY", "To top up, send an active WebLens API key; without one, the checkout opens a new account.", requestId), 401);
    } else {
        accountId = key.accountId;
    }

    const origin = new URL(c.req.url).origin;
    try {
        const session = await createCheckoutSession({
            secretKey,
            pack,
            accountId,
            successUrl: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${origin}/billing/cancel`,
        });
        c.get("log").info("billing.checkout_created", { account: accountId, pack, topUp: key !== "none" });
        return c.json({
            checkoutUrl: session.url,
            sessionId: session.id,
            pack: packPrice(pack),
            message: key === "none"
                ? "Open checkoutUrl in a browser and pay. The page you return to shows your API key once: store it."
                : "Open checkoutUrl in a browser and pay. The credit is added to the account of the key you sent.",
            requestId,
        });
    } catch (error) {
        c.get("log").error("billing.checkout_failed", { error: error instanceof Error ? error.message : String(error) });
        return c.json(createErrorResponse("SERVICE_UNAVAILABLE", "Could not open a Stripe Checkout; try again shortly.", requestId, 5), 503);
    }
}

export async function successPageHandler(c: Context<AppEnv>) {
    noStore(c);
    const secretKey = c.env.STRIPE_SECRET_KEY;
    if (!secretKey || !cardPaymentsEnabled(c.env)) {
        return c.html(htmlPage("Card payments are not configured", html`<p>Nothing was charged here.</p>`), 503);
    }
    const sessionId = c.req.query("session_id") ?? "";
    if (!SESSION_ID.test(sessionId)) {
        return c.html(htmlPage("Unknown checkout", html`<p>This link does not name a Stripe Checkout.</p>`), 400);
    }

    let fulfilment;
    try {
        fulfilment = await fulfillCheckout(c.env, secretKey, sessionId);
    } catch (error) {
        c.get("log").error("billing.success_fulfil_failed", { error: error instanceof Error ? error.message : String(error) });
        const status = error instanceof ForeignCheckoutError ? 400 : 502;
        return c.html(htmlPage("We could not confirm this payment yet", html`<p>Reload this page in a minute. If you were charged, the credit is added automatically as soon as Stripe confirms the payment.</p>`), status);
    }
    if (fulfilment.status === "unpaid") {
        return c.html(htmlPage("Payment processing", html`<p>Stripe has not confirmed the payment yet. Reload this page in a minute; the credit is added as soon as it is confirmed.</p>`), 202);
    }

    const secret = await accountStub(c.env, fulfilment.accountId).issueFirstKey();
    const balance = formatMicros(fulfilment.balanceMicros);
    if (secret === null) {
        return c.html(htmlPage("Payment received", html`<p>${packPrice(fulfilment.pack)} of credit is on your account. Balance: <strong>${balance}</strong>.</p>
<p>Keep using your existing API key. This page shows a key only once, when the purchase opens a new account.</p>`));
    }
    const apiKey = formatApiKey(c.env.API_KEY_PREFIX, fulfilment.accountId, secret);
    return c.html(htmlPage("Your WebLens API key", html`<p>${packPrice(fulfilment.pack)} of credit is on your account. Balance: <strong>${balance}</strong>.</p>
<p class="warn"><strong>Copy this key now.</strong> It is shown once and WebLens stores only a hash of it.</p>
<pre>${apiKey}</pre>
<p>Send it on any paid endpoint:</p>
<pre>curl -X POST ${new URL(c.req.url).origin}/fetch/basic \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com"}'</pre>
<p>Balance and usage: <code>GET /account</code>. Top up: <code>POST /billing/checkout</code> with the same key.</p>`));
}

export function cancelPageHandler(c: Context<AppEnv>) {
    noStore(c);
    return c.html(htmlPage("Checkout cancelled", html`<p>No card was charged. Open a new checkout any time with <code>POST /billing/checkout</code>.</p>`));
}

export async function stripeWebhookHandler(c: Context<AppEnv>) {
    const requestId = c.get("requestId");
    const secretKey = c.env.STRIPE_SECRET_KEY;
    const webhookSecret = c.env.STRIPE_WEBHOOK_SECRET;
    if (!secretKey || !webhookSecret) { return stripeUnavailable(c); }

    // The signature covers the raw body, so read it untouched before any parse.
    const rawBody = await c.req.text();
    const verification = await verifyStripeSignature({
        // A second secret is accepted during Stripe's webhook secret rotation.
        secret: c.env.STRIPE_WEBHOOK_SECRET_2 ? [webhookSecret, c.env.STRIPE_WEBHOOK_SECRET_2] : webhookSecret,
        payload: rawBody,
        header: c.req.header("stripe-signature") ?? null,
    });
    if (!verification.valid) {
        c.get("log").warn("billing.webhook_signature_invalid", { reason: verification.reason });
        return c.json(createErrorResponse("INVALID_REQUEST", `Signature verification failed: ${verification.reason ?? "unknown"}`, requestId), 400);
    }

    let parsed: unknown;
    try { parsed = JSON.parse(rawBody); } catch { parsed = undefined; }
    const event = stripeEvent(parsed);
    if (!event) {
        return c.json(createErrorResponse("INVALID_REQUEST", "Malformed webhook body", requestId), 400);
    }
    const reversal = paymentReversal(event);
    if (reversal) {
        try {
            const result = await reverseCheckout(c.env, secretKey, reversal);
            c.get("log").warn("billing.payment_reversed", { event: event.type, ...result });
            return c.json({ received: true, status: "reversed", requestId });
        } catch (error) {
            if (error instanceof ForeignCheckoutError) {
                return c.json({ received: true, ignored: "not a WebLens credit pack", requestId });
            }
            c.get("log").error("billing.webhook_reversal_failed", { error: error instanceof Error ? error.message : String(error) });
            // A 5xx makes Stripe retry; the ledger keeps the retry from reversing twice.
            return c.json(createErrorResponse("INTERNAL_ERROR", "Reversal failed; Stripe will retry.", requestId), 500);
        }
    }
    const sessionId = str(event.object.id);
    // Any other event is acknowledged, so Stripe stops retrying it.
    if (!FULFIL_EVENTS.has(event.type) || !sessionId) {
        return c.json({ received: true, ignored: event.type, requestId });
    }

    try {
        const fulfilment = await fulfillCheckout(c.env, secretKey, sessionId);
        c.get("log").info("billing.webhook_fulfilled", {
            event: event.type,
            status: fulfilment.status,
            account: fulfilment.accountId,
            duplicate: fulfilment.status === "credited" ? fulfilment.duplicate : false,
        });
        return c.json({ received: true, status: fulfilment.status, requestId });
    } catch (error) {
        if (error instanceof ForeignCheckoutError) {
            return c.json({ received: true, ignored: "not a WebLens credit pack", requestId });
        }
        c.get("log").error("billing.webhook_fulfil_failed", { error: error instanceof Error ? error.message : String(error) });
        // A 5xx makes Stripe retry; the session id keeps the retry from crediting twice.
        return c.json(createErrorResponse("INTERNAL_ERROR", "Fulfilment failed; Stripe will retry.", requestId), 500);
    }
}

/** The key in Authorization, or the 401 to answer with. */
function requireKey(c: Context<AppEnv>) {
    const key = parseApiKey(c.req.header("Authorization"), c.env.API_KEY_PREFIX);
    return typeof key === "string" ? undefined : key;
}

function invalidKey(c: Context<AppEnv>) {
    return c.json(createErrorResponse("INVALID_API_KEY", "Send your API key as \"Authorization: Bearer <key>\".", c.get("requestId")), 401);
}

export async function accountHandler(c: Context<AppEnv>) {
    noStore(c);
    const key = requireKey(c);
    const summary = key ? await accountStub(c.env, key.accountId).summary(key.secret) : null;
    if (!summary) { return invalidKey(c); }
    return c.json({
        balance: formatMicros(summary.balanceMicros),
        createdAt: summary.createdAt,
        keyCreatedAt: summary.keyCreatedAt,
        recent: summary.recent.map((entry) => ({
            kind: entry.kind,
            amount: formatMicros(entry.amountMicros),
            description: entry.description,
            createdAt: entry.createdAt,
        })),
        topUp: new URL("/billing/checkout", c.req.url).href,
        requestId: c.get("requestId"),
    });
}

export async function rotateKeyHandler(c: Context<AppEnv>) {
    noStore(c);
    const key = requireKey(c);
    const secret = key ? await accountStub(c.env, key.accountId).rotateKey(key.secret) : null;
    if (!key || secret === null) { return invalidKey(c); }
    c.get("log").info("billing.key_rotated", { account: key.accountId });
    return c.json({
        apiKey: formatApiKey(c.env.API_KEY_PREFIX, key.accountId, secret),
        message: "Your previous key no longer works. Store this one: it is not shown again.",
        requestId: c.get("requestId"),
    });
}
