/**
 * Receipt middleware.
 *
 * A receipt is the buyer's payment evidence for an ERC-8004 feedback
 * document, so it must be issued for exactly the calls that were paid and
 * served — never for an unpaid probe (which would let anyone fill KV) and
 * never for a failed or refunded call (which sold nothing).
 *
 * This path cannot be exercised end-to-end in production without settling a
 * real USDC payment, so the conditions are pinned here instead.
 */

import { encodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { Network } from "@x402/core/types";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it, vi } from "vitest";
import { receiptMiddleware } from "../../src/middleware/receipt";
import type { AppEnv } from "../../src/types";
import { createLogger } from "../../src/utils/logger";

interface CallOptions {
    path?: string;
    status?: ContentfulStatusCode;
    headers?: Record<string, string>;
    paidWithCredits?: boolean;
    responseHeaders?: Record<string, string>;
}

const REQUEST_ID = "wl_test_123";

/** One call through the real middleware, answered by a handler that sets the given status and headers. */
async function call(o: CallOptions = {}, put = vi.fn<KVNamespace["put"]>(() => Promise.resolve())) {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
        c.set("requestId", REQUEST_ID);
        c.set("paidWithCredits", o.paidWithCredits ?? false);
        c.set("log", createLogger("silent"));
        await next();
    });
    app.use("*", receiptMiddleware());
    app.all("*", (c) => c.body("{}", o.status ?? 200, o.responseHeaders ?? {}));

    const res = await app.request(
        `https://api.weblens.dev${o.path ?? "/search"}`,
        { method: "POST", headers: o.headers ?? {} },
        { CACHE: { put }, NETWORK: "base", PAY_TO_ADDRESS: "0xPayTo" },
    );
    return { res, put };
}

/** The receipt a call wrote, parsed. */
function written(put: ReturnType<typeof vi.fn<KVNamespace["put"]>>): Record<string, unknown> {
    const [key, body] = put.mock.calls[0] ?? [];
    expect(key).toBe(`receipt:${REQUEST_ID}`);
    if (typeof body !== "string") { throw new TypeError("the receipt was not written as JSON text"); }
    return JSON.parse(body) as Record<string, unknown>;
}

const BASE: Network = "eip155:8453";
const SOLANA: Network = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

/** The headers of a real settled x402 call on `network`, encoded by @x402/core itself. */
function settled(network: Network, payTo: string, amount: string, transaction: string) {
    const signature = encodePaymentSignatureHeader({
        x402Version: 2,
        accepted: { scheme: "exact", network, amount, asset: "usdc", payTo, maxTimeoutSeconds: 300, extra: {} },
        payload: {},
    });
    const response = encodePaymentResponseHeader({ success: true, network, transaction, payer: "buyer" });
    return { headers: { "Payment-Signature": signature }, responseHeaders: { "PAYMENT-RESPONSE": response } };
}

describe("receiptMiddleware", () => {
    it("writes a receipt for a paid x402 call that succeeded", async () => {
        const { res, put } = await call(settled(BASE, "0xPayTo", "15000", "0xtxhash"));

        expect(put).toHaveBeenCalledOnce();
        expect(written(put)).toMatchObject({
            type: "weblens-call-receipt-v1",
            requestId: REQUEST_ID,
            endpoint: "/search",
            outcome: "success",
            paymentMethod: "x402",
            price: "$0.015",
            network: BASE,
            payTo: "0xPayTo",
            transaction: "0xtxhash",
            payer: "buyer",
        });
        expect(res.headers.get("X-Receipt-Url")).toBe(`https://api.weblens.dev/receipts/${REQUEST_ID}`);
    });

    it("records the network actually paid on — a Solana payment is not stamped as Base", async () => {
        const { put } = await call(settled(SOLANA, "34sd6wSolanaPayTo", "200000", "5solanaSignature"));

        expect(written(put)).toMatchObject({
            network: SOLANA,
            payTo: "34sd6wSolanaPayTo",
            price: "$0.2",
            transaction: "5solanaSignature",
        });
    });

    it("issues no receipt for an x402 call that carries no settlement", async () => {
        const { headers } = settled(BASE, "0xPayTo", "15000", "0xtx");
        const { put } = await call({ headers }); // no PAYMENT-RESPONSE: nothing settled

        expect(put).not.toHaveBeenCalled();
    });

    it("records the credit price and method for a call paid with an API key", async () => {
        const { put } = await call({ paidWithCredits: true, responseHeaders: { "Credit-Cost": "$0.015" } });

        expect(written(put)).toMatchObject({ paymentMethod: "credits", price: "$0.015" });
    });

    it("issues no receipt for an unpaid probe", async () => {
        const { put } = await call(); // no payment headers at all

        expect(put).not.toHaveBeenCalled();
    });

    it("issues no receipt when the call failed or was refunded", async () => {
        for (const status of [400, 402, 404, 500, 502] as const) {
            const { put } = await call({ status, ...settled(BASE, "0xPayTo", "15000", "0xtx") });
            expect(put, `status ${String(status)} must not produce a receipt`).not.toHaveBeenCalled();
        }
    });

    it("ignores endpoints that are not sold", async () => {
        const { put } = await call({ path: "/health", ...settled(BASE, "0xPayTo", "15000", "0xtx") });

        expect(put).not.toHaveBeenCalled();
    });

    it("never fails the request when the receipt write throws", async () => {
        const put = vi.fn<KVNamespace["put"]>(() => Promise.reject(new Error("KV down")));

        // The buyer already paid — a bookkeeping failure must not surface.
        const { res } = await call(settled(BASE, "0xPayTo", "15000", "0xtx"), put);
        expect(res.status).toBe(200);
    });
});
