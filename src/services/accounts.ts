/**
 * Prepaid accounts, as the Worker sees them: API keys, the account's Durable
 * Object, and fulfilment of a paid Stripe Checkout.
 *
 * A key is `<API_KEY_PREFIX><accountId>_<secret>` (config.ts API_KEY_PATTERN).
 * The account id addresses the account's own Durable Object, which checks the
 * secret against the hash it stores and debits in the same call, so a revoked
 * key stops working on the next request (a KV-held key index would keep a
 * revoked key alive for up to 60 seconds of KV propagation).
 */

import { API_KEY_PATTERN, packPrice } from "../config";
import type { CreditPack } from "../config";
import type { CreditAccountDO, ReversalResult } from "../durable_objects/CreditAccountDO";
import type { Env } from "../types";
import { usdToMicros } from "./pricing";
import { checkoutForPayment, retrieveCheckout } from "./stripe";
import type { PaymentReversal } from "./stripe";

export interface ApiKey {
    accountId: string;
    secret: string;
}

/**
 * The WebLens API key in an `Authorization: Bearer wl_…` header.
 *
 * - `none`: no WebLens key. That includes someone else's credential: MCP clients send their own server
 *   login as `Authorization: Bearer <token>` on every request, and gateways add theirs, so a foreign
 *   Authorization header must leave the x402 path (the 402 challenge) exactly as it was.
 * - `invalid`: a `wl_` key that is malformed, from another environment, or sent without `Bearer`. The
 *   caller meant to pay with a key, so it gets a 401 rather than a payment challenge.
 */
export function parseApiKey(authorization: string | undefined, prefix: string): ApiKey | "none" | "invalid" {
    const match = authorization === undefined ? null : /^(Bearer\s+)?(wl_\S*)$/iu.exec(authorization.trim());
    if (!match?.[2]) { return "none"; }
    const parsed = match[1] ? API_KEY_PATTERN.exec(match[2]) : null;
    if (parsed?.[1] !== prefix || !parsed[2] || !parsed[3]) { return "invalid"; }
    return { accountId: parsed[2], secret: parsed[3] };
}

export function formatApiKey(prefix: string, accountId: string, secret: string): string {
    return `${prefix}${accountId}_${secret}`;
}

/** A new account id: 128 random bits, hex. */
export function newAccountId(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function accountStub(env: Env, accountId: string): DurableObjectStub<CreditAccountDO> {
    return env.ACCOUNTS.getByName(accountId);
}

export type Fulfilment =
    | { status: "credited"; accountId: string; pack: CreditPack; balanceMicros: number; duplicate: boolean }
    | { status: "unpaid"; accountId: string };

/**
 * Credit the account a Checkout Session paid for. Stripe's webhook and the success page both call this,
 * possibly at the same time, for the same session: the session id is the deposit's ledger id, so only
 * the first call adds money (docs.stripe.com/checkout/fulfillment).
 */
export async function fulfillCheckout(env: Env, secretKey: string, sessionId: string): Promise<Fulfilment> {
    const checkout = await retrieveCheckout(secretKey, sessionId);
    if (checkout.paymentStatus === "unpaid") {
        return { status: "unpaid", accountId: checkout.accountId };
    }
    const { balanceMicros, duplicate } = await accountStub(env, checkout.accountId).deposit(
        checkout.sessionId,
        usdToMicros(packPrice(checkout.pack)),
        `Credit pack ${packPrice(checkout.pack)}`,
    );
    return { status: "credited", accountId: checkout.accountId, pack: checkout.pack, balanceMicros, duplicate };
}

/**
 * Take back the credit of a refunded or disputed card payment. The Checkout Session is found from the
 * payment and re-read from Stripe (it must be one of our packs); a refund reverses the share of the pack
 * that was refunded, a dispute all of it.
 */
export async function reverseCheckout(env: Env, secretKey: string, reversal: PaymentReversal): Promise<ReversalResult & { accountId: string }> {
    const checkout = await retrieveCheckout(secretKey, await checkoutForPayment(secretKey, reversal.paymentIntent));
    const packMicros = usdToMicros(packPrice(checkout.pack));
    const targetMicros = reversal.reason === "dispute" ? packMicros : Math.round(packMicros * reversal.refunded / reversal.charged);
    const result = await accountStub(env, checkout.accountId).reverseDeposit(checkout.sessionId, targetMicros, reversal.reason);
    return { ...result, accountId: checkout.accountId };
}
