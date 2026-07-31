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

import { describe, expect, it, vi } from "vitest";
import { receiptMiddleware } from "../../src/middleware/receipt";

interface CtxOptions {
    path?: string;
    status?: number;
    headers?: Record<string, string>;
    paidWithCredits?: boolean;
    requestId?: string;
    responseHeaders?: Record<string, string>;
}

function makeCtx(o: CtxOptions = {}) {
    const put = vi.fn(() => Promise.resolve());
    const resHeaders = new Map<string, string>(Object.entries(o.responseHeaders ?? {}));
    const vars = new Map<string, unknown>([
        ["requestId", o.requestId ?? "wl_test_123"],
        ["paidWithCredits", o.paidWithCredits ?? false],
        ["log", { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }],
    ]);
    const ctx = {
        env: { CACHE: { put }, NETWORK: "base", PAY_TO_ADDRESS: "0xPayTo" },
        req: {
            path: o.path ?? "/search",
            method: "POST",
            url: `https://api.weblens.dev${o.path ?? "/search"}`,
            header: (name: string) => (o.headers ?? {})[name],
        },
        res: {
            status: o.status ?? 200,
            headers: {
                get: (k: string) => resHeaders.get(k) ?? null,
                set: (k: string, v: string) => resHeaders.set(k, v),
            },
        },
        get: (k: string) => vars.get(k),
        set: (k: string, v: unknown) => vars.set(k, v),
    };
    return { ctx, put, resHeaders };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (ctx: any) => receiptMiddleware()(ctx, () => Promise.resolve()) as Promise<void>;

describe("receiptMiddleware", () => {
    it("writes a receipt for a paid x402 call that succeeded", async () => {
        const { ctx, put, resHeaders } = makeCtx({ headers: { "Payment-Signature": "0xsig" } });

        await run(ctx);

        expect(put).toHaveBeenCalledOnce();
        const [key, body] = put.mock.calls[0] as unknown as [string, string];
        expect(key).toBe("receipt:wl_test_123");
        const receipt = JSON.parse(body) as Record<string, unknown>;
        expect(receipt).toMatchObject({
            type: "weblens-call-receipt-v1",
            requestId: "wl_test_123",
            endpoint: "/search",
            outcome: "success",
            paymentMethod: "x402",
            network: "base",
            payTo: "0xPayTo",
        });
        expect(resHeaders.get("X-Receipt-Url")).toBe("https://api.weblens.dev/receipts/wl_test_123");
    });

    it("records the credit price and method for a credit-paid call", async () => {
        const { ctx, put } = makeCtx({
            paidWithCredits: true,
            responseHeaders: { "Credit-Cost": "$0.015" },
        });

        await run(ctx);

        const receipt = JSON.parse((put.mock.calls[0] as unknown as [string, string])[1]) as Record<string, unknown>;
        expect(receipt.paymentMethod).toBe("credits");
        expect(receipt.price).toBe("$0.015");
    });

    it("issues no receipt for an unpaid probe", async () => {
        const { ctx, put } = makeCtx(); // no payment headers at all

        await run(ctx);

        expect(put).not.toHaveBeenCalled();
    });

    it("issues no receipt when the call failed or was refunded", async () => {
        for (const status of [400, 402, 404, 500, 502]) {
            const { ctx, put } = makeCtx({ status, headers: { "Payment-Signature": "0xsig" } });
            await run(ctx);
            expect(put, `status ${String(status)} must not produce a receipt`).not.toHaveBeenCalled();
        }
    });

    it("ignores endpoints that are not sold", async () => {
        const { ctx, put } = makeCtx({ path: "/health", headers: { "Payment-Signature": "0xsig" } });

        await run(ctx);

        expect(put).not.toHaveBeenCalled();
    });

    it("never fails the request when the receipt write throws", async () => {
        const { ctx } = makeCtx({ headers: { "Payment-Signature": "0xsig" } });
        (ctx.env.CACHE.put as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("KV down"));

        // The buyer already paid — a bookkeeping failure must not surface.
        await expect(run(ctx)).resolves.toBeUndefined();
    });
});
