/**
 * Pay for a paid route with a prepaid API key (`Authorization: Bearer <key>`).
 *
 * - No WebLens key (no Authorization, or someone else's credential such as an MCP
 *   client's own login token): not a key call, the x402 payment wall handles it.
 * - A `wl_` key that is malformed, from another environment, or not active: 401
 *   INVALID_API_KEY. The caller meant to use a key, so it is never asked for x402.
 * - Too little balance: 402 INSUFFICIENT_CREDITS with the balance and where to
 *   top up. It carries no x402 challenge, so an x402 client will not try to pay it.
 *
 * A key call pays the route's list price, without the x402 floor: it settles
 * nothing on-chain. Handlers report failures by returning error envelopes, so
 * the debit is refunded both when the handler throws and when the response
 * status is >= 400; the account's ledger makes the refund idempotent.
 */

import type { Context, MiddlewareHandler } from "hono";
import { accountStub, parseApiKey } from "../services/accounts";
import { formatMicros, usdToMicros } from "../services/pricing";
import type { AppEnv } from "../types";
import { createErrorResponse } from "./errorHandler";

/** Where a buyer tops up, relative to the API origin. */
export const TOP_UP_PATH = "/billing/checkout";

export function createApiKeyMiddleware(
    cost: string | ((c: Context<AppEnv>) => Promise<string>),
    description: string,
): MiddlewareHandler<AppEnv> {
    return async (c, next) => {
        const key = parseApiKey(c.req.header("Authorization"), c.env.API_KEY_PREFIX);
        if (key === "none") {
            await next();
            return;
        }
        const requestId = c.get("requestId");
        const log = c.get("log");
        if (key === "invalid") {
            return c.json(createErrorResponse(
                "INVALID_API_KEY",
                `This WebLens API key is malformed or belongs to another environment (keys here start with ${c.env.API_KEY_PREFIX}).`,
                requestId,
            ), 401);
        }

        const price = typeof cost === "string" ? cost : await cost(c);
        const account = accountStub(c.env, key.accountId);
        const debit = await account.spend(key.secret, usdToMicros(price), requestId, description);
        if (!debit.ok) {
            if (debit.reason === "invalid_key") {
                log.warn("apikey.rejected", { account: key.accountId });
                return c.json(createErrorResponse(
                    "INVALID_API_KEY",
                    "This API key is not active. Rotated keys stop working at once.",
                    requestId,
                ), 401);
            }
            return c.json({
                ...createErrorResponse(
                    "INSUFFICIENT_CREDITS",
                    `This call costs ${price} and the account holds ${formatMicros(debit.balanceMicros)}. Top up with POST ${TOP_UP_PATH} and your key.`,
                    requestId,
                ),
                price,
                balance: formatMicros(debit.balanceMicros),
                topUp: new URL(TOP_UP_PATH, c.req.url).href,
            }, 402);
        }

        c.set("paidWithCredits", true);
        log.info("apikey.debit", { account: key.accountId, price, description });

        const refund = async (reason: string): Promise<void> => {
            try {
                const { refundedMicros } = await account.refund(requestId);
                log.warn("apikey.refund", { account: key.accountId, price, reason, refunded: formatMicros(refundedMicros) });
            } catch (error) {
                // Never mask the original failure; the ledger shows the unrefunded spend for an operator.
                log.error("apikey.refund_failed", {
                    account: key.accountId,
                    price,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        };

        try {
            await next();
        } catch (error) {
            await refund("handler_failure");
            throw error;
        }
        c.header("Payment-Method", "Credits");
        if (c.res.status >= 400) {
            await refund("error_response");
            c.header("Credit-Refunded", price);
        } else {
            c.header("Credit-Cost", price);
            c.header("Credit-Balance", formatMicros(debit.balanceMicros));
        }
    };
}
