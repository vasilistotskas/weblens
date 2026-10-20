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
import type { CreditAccountDO } from "../durable_objects/CreditAccountDO";
import type { Env } from "../types";
import { usdToMicros } from "./pricing";
import { retrieveCheckout } from "./stripe";

export interface ApiKey {
    accountId: string;
    secret: string;
}

/**
 * The API key in an `Authorization: Bearer` header. `absent` when the request carries no Authorization
 * header at all (it may still pay with x402); `invalid` for any other header that is not a key of this
 * environment, which is answered with a 401 rather than falling through to x402.
 */
export function parseApiKey(authorization: string | undefined, prefix: string): ApiKey | "absent" | "invalid" {
    if (authorization === undefined) { return "absent"; }
    const match = /^Bearer\s+(\S+)$/iu.exec(authorization.trim());
    const parsed = match?.[1] ? API_KEY_PATTERN.exec(match[1]) : null;
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
