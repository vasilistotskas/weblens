/**
 * Stripe fiat onramp — Workers-native, no SDK dependency.
 *
 * We talk to Stripe's REST API directly so the Worker bundle stays small and
 * no Node shims are pulled in. Webhook signature verification uses WebCrypto
 * (`crypto.subtle.importKey` + `sign`) exactly matching Stripe's documented
 * HMAC-SHA256 scheme.
 *
 * Reference:
 *   https://docs.stripe.com/webhooks/signatures
 *   https://docs.stripe.com/api/checkout/sessions/create
 */

interface CheckoutSessionParams {
    secretKey: string;
    amountUsd: number;
    wallet: string;
    successUrl: string;
    cancelUrl: string;
}

interface CheckoutSession {
    id: string;
    url: string;
}

/**
 * Create a Stripe Checkout session for a one-time USD credit purchase.
 * The wallet address is embedded in metadata so the webhook can credit the
 * right account on `checkout.session.completed`.
 */
export async function createCheckoutSession(
    params: CheckoutSessionParams
): Promise<CheckoutSession> {
    const amountCents = Math.round(params.amountUsd * 100);

    // Stripe expects form-encoded bodies for its REST API (not JSON).
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("success_url", params.successUrl);
    form.set("cancel_url", params.cancelUrl);
    form.set("line_items[0][price_data][currency]", "usd");
    form.set(
        "line_items[0][price_data][product_data][name]",
        `WebLens credits ($${params.amountUsd.toFixed(2)})`
    );
    form.set(
        "line_items[0][price_data][product_data][description]",
        `Prepaid API credits for wallet ${params.wallet}`
    );
    form.set("line_items[0][price_data][unit_amount]", String(amountCents));
    form.set("line_items[0][quantity]", "1");
    form.set("metadata[wallet]", params.wallet);
    form.set("metadata[amountUsd]", params.amountUsd.toFixed(2));
    form.set("payment_intent_data[metadata][wallet]", params.wallet);
    form.set("payment_intent_data[metadata][amountUsd]", params.amountUsd.toFixed(2));

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${params.secretKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
        signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
        // Log the full Stripe error server-side for debugging but surface a
        // generic message to the caller — Stripe error bodies can include
        // card tail digits, billing metadata, or HTML from upstream proxies.
        const text = await response.text();
        console.error(`[stripe] checkout.sessions.create ${String(response.status)}: ${text.slice(0, 500)}`);
        throw new Error(`Stripe checkout session creation failed (HTTP ${String(response.status)})`);
    }

    const data = await response.json<{ id: string; url: string }>();
    return { id: data.id, url: data.url };
}

/**
 * Verify a Stripe webhook signature using WebCrypto HMAC-SHA256.
 *
 * Header format: `t=<unix>,v1=<hex_signature>[,v1=<...>]`
 * Signed payload: `<timestamp>.<raw_body>`
 * Tolerance: reject if |now - t| > 5 minutes (Stripe default).
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

    const tolerance = params.toleranceSeconds ?? 300;
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

// ============================================
// Webhook event shapes (minimal — we only care about checkout.session.completed)
// ============================================

export interface StripeWebhookEvent {
    id: string;
    type: string;
    data: {
        object: {
            id?: string;
            metadata?: Record<string, string>;
            payment_status?: string;
            amount_total?: number;
        };
    };
}
