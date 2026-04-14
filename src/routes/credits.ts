import type { Hono } from "hono";
import { createLazyPaymentMiddleware } from "../middleware/payment";
import { validateRequest } from "../middleware/validation";
import { CreditsBuyRequestSchema, FiatDepositRequestSchema } from "../schemas";

// Tool Handlers
import { buyCreditsHandler, getBalanceHandler, getHistoryHandler } from "../tools/credits";
import { createFiatCheckoutHandler, stripeWebhookHandler } from "../tools/fiatDeposit";
import type { Env, Variables } from "../types";

export function registerCreditsRoutes(app: Hono<{ Bindings: Env; Variables: Variables }>) {

    // ============================================
    // /credits/buy
    // ============================================
    app.use(
        "/credits/buy",
        validateRequest(CreditsBuyRequestSchema),
        createLazyPaymentMiddleware(
            "/credits/buy",
            (c) => {
                const body = c.get("validatedBody") as { amount?: number } | undefined;
                const amount = body?.amount ?? 2;
                return Promise.resolve(`$${amount.toFixed(2)}`);
            },
            "Buy prepaid credits for WebLens API. Credits are used for all paid endpoints and offer bonuses at $10/$50/$100 tiers.",
            { amount: 10 },
            {
                properties: {
                    amount: { type: "number", description: "Amount in USD to purchase (min $2)" },
                },
                required: ["amount"],
            },
            {
                success: true,
                newBalance: 15.00,
                addedCredits: 10.00,
                bonus: 0,
                transactionId: "tx_123",
                requestId: "req_credits456",
            },
            {
                properties: {
                    success: { type: "boolean" },
                    newBalance: { type: "number" },
                    addedCredits: { type: "number" },
                    bonus: { type: "number" },
                    transactionId: { type: "string" },
                    requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/credits/buy", buyCreditsHandler);

    // ============================================
    // /credits/balance - Authenticated by Wallet Signature
    // ============================================
    app.get("/credits/balance", getBalanceHandler);

    // ============================================
    // /credits/history - Authenticated by Wallet Signature
    // ============================================
    app.get("/credits/history", getHistoryHandler);

    // ============================================
    // /credits/deposit/fiat — Stripe Checkout for card-funded credits
    // Zero-crypto onboarding: user submits {amount, wallet}, gets a Stripe
    // checkout URL, pays with card, webhook credits the wallet.
    // ============================================
    app.post(
        "/credits/deposit/fiat",
        validateRequest(FiatDepositRequestSchema),
        createFiatCheckoutHandler
    );

    // ============================================
    // /credits/webhook/stripe — Stripe webhook (signature-verified)
    // Must NOT go through JSON validation because signature verification
    // requires the raw untouched body.
    // ============================================
    app.post("/credits/webhook/stripe", stripeWebhookHandler);

    // User-facing redirect landings from Stripe Checkout. Plain HTML so the
    // developer lands somewhere friendly after paying with a card.
    app.get("/credits/fiat/success", (c) => {
        const sessionId = c.req.query("session_id") ?? "";
        return c.html(
            `<!doctype html><html><head><title>WebLens — Payment received</title>` +
            `<meta name="color-scheme" content="light dark"></head>` +
            `<body style="font-family:system-ui;max-width:560px;margin:4rem auto;padding:0 1rem;line-height:1.6">` +
            `<h1>Payment received ✓</h1>` +
            `<p>Your WebLens credits will be applied to your wallet within ~30 seconds once Stripe finalizes settlement.</p>` +
            `<p>Session: <code>${sessionId || "(unknown)"}</code></p>` +
            `<p>Check your balance: <code>GET /credits/balance</code> (with signed wallet headers).</p>` +
            `<p><a href="/docs">API docs</a> · <a href="/discovery">Service catalog</a></p>` +
            `</body></html>`
        );
    });

    app.get("/credits/fiat/cancel", (c) => {
        return c.html(
            `<!doctype html><html><head><title>WebLens — Payment cancelled</title>` +
            `<meta name="color-scheme" content="light dark"></head>` +
            `<body style="font-family:system-ui;max-width:560px;margin:4rem auto;padding:0 1rem;line-height:1.6">` +
            `<h1>Payment cancelled</h1>` +
            `<p>No card was charged. You can retry any time:</p>` +
            `<pre style="background:#8881;padding:1rem;border-radius:8px;overflow:auto">` +
            `POST /credits/deposit/fiat\n` +
            `{ "amount": 5, "wallet": "0x..." }` +
            `</pre>` +
            `</body></html>`
        );
    });
}
