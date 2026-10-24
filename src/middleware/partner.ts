/**
 * Calls a marketplace partner makes for its own users (PARTNERS in config.ts).
 *
 * The marketplace is the merchant of record: it bills its user and pays
 * WebLens, so such a call skips x402 and the prepaid ledger. It is recorded as
 * a `partner` payment event (unsampled, unlike the logs) so the marketplace's
 * payouts can be checked against the calls WebLens served.
 *
 * - No partner header: not a partner call; the API key and x402 middlewares handle it.
 * - A partner header whose secret is wrong, or whose partner has no secret set:
 *   401 INVALID_PARTNER_KEY. The caller meant to call as a partner, so it is never
 *   asked for x402.
 */

import type { Context, MiddlewareHandler } from "hono";
import { PARTNERS } from "../config";
import type { PartnerName } from "../config";
import { emitPaymentEvent } from "../services/payment-telemetry";
import { usdToMicros } from "../services/pricing";
import type { AppEnv } from "../types";
import { timingSafeEqualText } from "../utils/timing-safe";
import { createErrorResponse } from "./errorHandler";

const PARTNER_NAMES = Object.keys(PARTNERS) as PartnerName[];

/** True when the request carries any partner's header (validation treats it as a paying request). */
export function carriesPartnerKey(c: Context<AppEnv>): boolean {
    return PARTNER_NAMES.some((name) => c.req.header(PARTNERS[name].header) !== undefined);
}

/** The partner the request authenticates as, "none" without a partner header, "invalid" for a wrong secret. */
async function partnerOf(c: Context<AppEnv>): Promise<PartnerName | "none" | "invalid"> {
    for (const name of PARTNER_NAMES) {
        const sent = c.req.header(PARTNERS[name].header);
        if (sent === undefined) { continue; }
        const secret = c.env[PARTNERS[name].secret];
        if (!secret) { return "invalid"; }
        // Compare digests, so the comparison takes the same time whatever the sent value's length.
        const [sentDigest, secretDigest] = await Promise.all([sent, secret].map(sha256Hex));
        return timingSafeEqualText(sentDigest ?? "", secretDigest ?? "") ? name : "invalid";
    }
    return "none";
}

async function sha256Hex(text: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createPartnerMiddleware(
    cost: string | ((c: Context<AppEnv>) => Promise<string>),
    route: string,
): MiddlewareHandler<AppEnv> {
    return async (c, next) => {
        const partner = await partnerOf(c);
        if (partner === "none") {
            await next();
            return;
        }
        const requestId = c.get("requestId");
        if (partner === "invalid") {
            return c.json(createErrorResponse("INVALID_PARTNER_KEY", "This partner key is not valid.", requestId), 401);
        }

        c.set("paymentMethod", "partner");
        const price = typeof cost === "string" ? cost : await cost(c);
        const started = Date.now();
        let threw = false;
        try {
            await next();
        } catch (error) {
            threw = true;
            throw error;
        } finally {
            const status = c.res.status;
            emitPaymentEvent(c.env.PAYMENT_EVENTS, c.get("log"), {
                outcome: "partner",
                route,
                requestId,
                payer: partner,
                amount: String(usdToMicros(price)),
                reason: threw ? "handler threw" : status >= 400 ? `answered ${String(status)}` : undefined,
                latencyMs: Date.now() - started,
            });
        }
        c.header("Payment-Method", "Partner");
    };
}
