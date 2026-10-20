/**
 * Stripe Checkout with Managed Payments, over Stripe's REST API (no SDK, so
 * the Worker bundle pulls in no Node shims). Webhook signatures are verified
 * with WebCrypto HMAC-SHA256, exactly as Stripe documents.
 *
 * Reference (read 2026-10-20):
 *   https://docs.stripe.com/payments/managed-payments/set-up
 *   https://docs.stripe.com/payments/managed-payments/update-checkout (parameters Managed Payments refuses)
 *   https://docs.stripe.com/checkout/fulfillment
 *   https://docs.stripe.com/webhooks/signatures
 */

import { CREDIT_PACKS, packPrice, STRIPE } from "../config";
import type { CreditPack } from "../config";
import { asRecords, isRecord, num, str } from "../utils/narrow";
import { usdToMicros } from "./pricing";

/** A pack's price in cents, the unit Stripe amounts use for USD. */
export function packCents(pack: CreditPack): number {
    return usdToMicros(packPrice(pack)) / 10_000;
}

export function isCreditPack(value: string | undefined): value is CreditPack {
    return CREDIT_PACKS.some((pack) => pack === value);
}

async function stripeRequest(secretKey: string, path: string, init: { method: "GET" | "POST"; form?: URLSearchParams }): Promise<Record<string, unknown>> {
    const response = await fetch(`${STRIPE.apiBase}${path}`, {
        method: init.method,
        headers: {
            Authorization: `Bearer ${secretKey}`,
            "Stripe-Version": STRIPE.apiVersion,
            ...(init.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        body: init.form?.toString(),
        signal: AbortSignal.timeout(STRIPE.timeoutMs),
    });
    const body: unknown = await response.json();
    if (!response.ok || !isRecord(body)) {
        // Stripe's error type and code only: its message can echo request details.
        const error = isRecord(body) && isRecord(body.error) ? body.error : {};
        throw new Error(`Stripe ${init.method} ${path.split("?")[0] ?? path} failed: HTTP ${String(response.status)} ${str(error.type) ?? ""} ${str(error.code) ?? ""}`.trim());
    }
    return body;
}

/**
 * Open a Managed Payments Checkout Session for `pack`, crediting `accountId`. The line item is an inline
 * price with the product's tax code (Managed Payments accepts `price_data` when `product_data.tax_code`
 * is set), so no Stripe Dashboard setup is needed per pack.
 */
export async function createCheckoutSession(params: {
    secretKey: string;
    pack: CreditPack;
    accountId: string;
    successUrl: string;
    cancelUrl: string;
}): Promise<{ id: string; url: string }> {
    const form = new URLSearchParams({
        mode: "payment",
        "managed_payments[enabled]": "true",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": String(packCents(params.pack)),
        "line_items[0][price_data][product_data][name]": `${STRIPE.productName} (${packPrice(params.pack)})`,
        "line_items[0][price_data][product_data][tax_code]": STRIPE.taxCode,
        client_reference_id: params.accountId,
        "metadata[pack]": params.pack,
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
    });
    const session = await stripeRequest(params.secretKey, "/checkout/sessions", { method: "POST", form });
    const id = str(session.id);
    const url = str(session.url);
    if (!id || !url) { throw new Error("Stripe returned a Checkout Session without an id or url"); }
    return { id, url };
}

/** A Checkout Session that is not a WebLens credit pack: another product sold from the same Stripe account. */
export class ForeignCheckoutError extends Error {}

/** What fulfilment needs from a Checkout Session, read from Stripe itself rather than from a webhook body. */
export interface PaidCheckout {
    sessionId: string;
    accountId: string;
    pack: CreditPack;
    /** "paid", "unpaid" or "no_payment_required" (Stripe's `payment_status`). */
    paymentStatus: string;
}

/**
 * Retrieve a Checkout Session with its line items and check that it is one of ours: it names an account
 * and a pack, and its single line item is that pack's USD price. Managed Payments always runs Adaptive
 * Pricing, so the buyer may have paid in another currency; the price object stays in USD.
 */
export async function retrieveCheckout(secretKey: string, sessionId: string): Promise<PaidCheckout> {
    const session = await stripeRequest(secretKey, `/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items`, { method: "GET" });
    const accountId = str(session.client_reference_id);
    const pack = isRecord(session.metadata) ? str(session.metadata.pack) : undefined;
    const items = asRecords(isRecord(session.line_items) ? session.line_items.data : undefined);
    const price = isRecord(items[0]?.price) ? items[0].price : undefined;
    if (!accountId || !isCreditPack(pack) || items.length !== 1 || num(items[0]?.quantity) !== 1
        || str(price?.currency) !== "usd" || num(price?.unit_amount) !== packCents(pack)) {
        throw new ForeignCheckoutError(`Checkout Session ${sessionId} is not a WebLens credit pack`);
    }
    return { sessionId, accountId, pack, paymentStatus: str(session.payment_status) ?? "unpaid" };
}

/**
 * Verify a Stripe webhook signature using WebCrypto HMAC-SHA256.
 *
 * Header format: `t=<unix>,v1=<hex_signature>[,v1=<...>]`
 * Signed payload: `<timestamp>.<raw_body>`
 * Tolerance: reject if |now - t| > STRIPE.webhookToleranceSeconds.
 *
 * `secret` accepts either a single string or an array of strings to support
 * zero-downtime rotation (Stripe exposes two active webhook secrets during
 * a rotation window). Any one matching secret verifies the signature.
 */
export async function verifyStripeSignature(params: {
    secret: string | string[];
    payload: string;
    header: string | null;
    toleranceSeconds?: number;
}): Promise<{ valid: boolean; reason?: string }> {
    if (!params.header) {return { valid: false, reason: "Missing Stripe-Signature header" };}

    const parts = params.header.split(",");
    let timestamp: string | null = null;
    const signatures: string[] = [];
    for (const part of parts) {
        const [k, v] = part.split("=", 2);
        if (!k || !v) {continue;}
        if (k === "t") {timestamp = v;}
        else if (k === "v1") {signatures.push(v);}
    }
    if (!timestamp) {return { valid: false, reason: "Signature missing timestamp" };}
    if (signatures.length === 0) {return { valid: false, reason: "Signature missing v1" };}

    const tolerance = params.toleranceSeconds ?? STRIPE.webhookToleranceSeconds;
    const nowSec = Math.floor(Date.now() / 1000);
    const tsInt = parseInt(timestamp, 10);
    if (!Number.isFinite(tsInt) || Math.abs(nowSec - tsInt) > tolerance) {
        return { valid: false, reason: "Timestamp outside tolerance" };
    }

    const signedPayload = `${timestamp}.${params.payload}`;
    const secrets = Array.isArray(params.secret) ? params.secret : [params.secret];

    for (const secret of secrets) {
        if (!secret) {continue;}
        const key = await crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(secret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );
        const sigBytes = await crypto.subtle.sign(
            "HMAC",
            key,
            new TextEncoder().encode(signedPayload)
        );
        const expected = Array.from(new Uint8Array(sigBytes))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");

        if (signatures.some((sig) => timingSafeEqualHex(sig, expected))) {
            return { valid: true };
        }
    }
    return { valid: false, reason: "Signature mismatch" };
}

/**
 * Constant-time hex-string comparison. Runs the full loop over the longer
 * input regardless of length mismatch — an early `a.length !== b.length`
 * short-circuit leaks "wrong length" vs "right length wrong value" via
 * observable timing.
 */
function timingSafeEqualHex(a: string, b: string): boolean {
    const maxLen = a.length > b.length ? a.length : b.length;
    let mismatch = a.length ^ b.length;
    for (let i = 0; i < maxLen; i++) {
        const ca = i < a.length ? a.charCodeAt(i) : 0;
        const cb = i < b.length ? b.charCodeAt(i) : 0;
        mismatch |= ca ^ cb;
    }
    return mismatch === 0;
}

/** The event fields the webhook acts on: its type and the Checkout Session id it concerns. */
export function checkoutEvent(body: unknown): { type: string; sessionId?: string } | undefined {
    if (!isRecord(body)) { return undefined; }
    const type = str(body.type);
    if (!type) { return undefined; }
    const object = isRecord(body.data) && isRecord(body.data.object) ? body.data.object : undefined;
    return { type, sessionId: str(object?.id) };
}
