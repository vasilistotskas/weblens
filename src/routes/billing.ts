import type { Context, Hono, Next } from "hono";
import { createErrorResponse } from "../middleware/errorHandler";
import { validateRequest } from "../middleware/validation";
import { CheckoutRequestSchema, WaitlistRequestSchema } from "../schemas";
import { parseApiKey } from "../services/accounts";
import {
    accountHandler,
    cancelPageHandler,
    checkoutHandler,
    rotateKeyHandler,
    stripeWebhookHandler,
    successPageHandler,
    waitlistHandler,
} from "../tools/billing";
import type { AppEnv } from "../types";

/**
 * Each checkout opens a Stripe Checkout Session, each rotation issues a key and each waitlist sign-up
 * writes to KV, so all three are limited
 * (BILLING_LIMITER, wrangler.toml): by the account of a key when one is sent, otherwise by the client IP,
 * the only identity a first-time buyer has.
 */
async function billingRateLimit(c: Context<AppEnv>, next: Next) {
    const key = parseApiKey(c.req.header("Authorization"), c.env.API_KEY_PREFIX);
    const actor = typeof key === "object" ? `account:${key.accountId}` : `ip:${c.req.header("cf-connecting-ip") ?? "unknown"}`;
    const { success } = await c.env.BILLING_LIMITER.limit({ key: `${c.req.path}:${actor}` });
    if (!success) {
        c.header("Retry-After", "60");
        return c.json(createErrorResponse("RATE_LIMITED", "Too many billing requests; try again in a minute.", c.get("requestId"), 60), 429);
    }
    await next();
}

/** Prepaid packs by card and the account an API key opens (see tools/billing.ts). */
export function registerBillingRoutes(app: Hono<AppEnv>): void {
    app.post("/billing/checkout", billingRateLimit, validateRequest(CheckoutRequestSchema), checkoutHandler);
    app.post("/billing/waitlist", billingRateLimit, validateRequest(WaitlistRequestSchema), waitlistHandler);
    app.get("/billing/success", successPageHandler);
    app.get("/billing/cancel", cancelPageHandler);
    // Signature-verified against the raw body, so it skips JSON validation.
    app.post("/billing/webhook", stripeWebhookHandler);

    app.get("/account", accountHandler);
    app.post("/account/key/rotate", billingRateLimit, rotateKeyHandler);
}
