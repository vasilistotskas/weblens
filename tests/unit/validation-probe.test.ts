/**
 * Unauthenticated probes of paid endpoints must reach the x402 payment
 * middleware (402) instead of being rejected with a 400.
 *
 * Production evidence: 170 bare POSTs to /intel/site-audit bounced as 400,
 * so probing agents concluded the resource was not payable. x402scan
 * documents this exact failure as "Expected 402, got 400".
 *
 * Paying/credit requests keep strict validation — money must never move on
 * an invalid body.
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { validateRequest } from "../../src/middleware/validation";

const schema = z.object({ url: z.url() });

interface MockOptions {
    path: string;
    body?: string;
    contentType?: string | undefined;
    headers?: Record<string, string>;
}

function mockContext({ path, body = "{}", contentType = "application/json", headers = {} }: MockOptions) {
    const all: Record<string, string | undefined> = { ...headers };
    if (contentType !== undefined) { all["Content-Type"] = contentType; }
    const vars = new Map<string, unknown>([["log", { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }]]);
    const json = vi.fn((payload: unknown, status: number) => ({ payload, status }));
    return {
        ctx: {
            req: {
                path,
                method: "POST",
                header: (name: string) => all[name],
                json: () => JSON.parse(body) as unknown,
            },
            get: (k: string) => vars.get(k),
            set: (k: string, v: unknown) => vars.set(k, v),
            json,
        },
        json,
        vars,
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (c: any, next: () => Promise<void>) => validateRequest(schema)(c, next) as Promise<unknown>;

describe("validateRequest — unpaid probe fallthrough", () => {
    it("lets an unpaid probe with an invalid body reach the payment middleware", async () => {
        const { ctx, json } = mockContext({ path: "/intel/site-audit", body: "{}" });
        const next = vi.fn(async () => { /* payment middleware */ });

        await run(ctx, next);

        expect(next).toHaveBeenCalledOnce();
        expect(json).not.toHaveBeenCalled();
    });

    it("lets an unpaid probe with no content-type through", async () => {
        const { ctx, json } = mockContext({ path: "/search/news", contentType: undefined });
        const next = vi.fn(async () => { /* payment middleware */ });

        await run(ctx, next);

        expect(next).toHaveBeenCalledOnce();
        expect(json).not.toHaveBeenCalled();
    });

    it("lets an unpaid probe with malformed JSON through", async () => {
        const { ctx, json } = mockContext({ path: "/answer", body: "not json{" });
        const next = vi.fn(async () => { /* payment middleware */ });

        await run(ctx, next);

        expect(next).toHaveBeenCalledOnce();
        expect(json).not.toHaveBeenCalled();
    });

    it("still rejects an invalid body when the request carries an x402 payment", async () => {
        const { ctx, json } = mockContext({
            path: "/intel/site-audit",
            body: "{}",
            headers: { "Payment-Signature": "0xdeadbeef" },
        });
        const next = vi.fn(async () => { /* handler */ });

        await run(ctx, next);

        expect(next).not.toHaveBeenCalled();
        expect(json).toHaveBeenCalledOnce();
        expect(json.mock.calls[0]?.[1]).toBe(400);
    });

    it("still rejects an invalid body when the request carries credit auth", async () => {
        const { ctx, json } = mockContext({
            path: "/contents",
            body: "{}",
            headers: { "X-CREDIT-WALLET": "0xabc" },
        });
        const next = vi.fn(async () => { /* handler */ });

        await run(ctx, next);

        expect(next).not.toHaveBeenCalled();
        expect(json.mock.calls[0]?.[1]).toBe(400);
    });

    it("still rejects invalid bodies on non-paid routes", async () => {
        const { ctx, json } = mockContext({ path: "/free/fetch", body: "{}" });
        const next = vi.fn(async () => { /* handler */ });

        await run(ctx, next);

        expect(next).not.toHaveBeenCalled();
        expect(json.mock.calls[0]?.[1]).toBe(400);
    });

    it("enforces the body-size cap even for probes", async () => {
        const { ctx, json } = mockContext({
            path: "/contents",
            headers: { "Content-Length": String(300 * 1024) },
        });
        const next = vi.fn(async () => { /* handler */ });

        await run(ctx, next);

        expect(next).not.toHaveBeenCalled();
        expect(json.mock.calls[0]?.[1]).toBe(413);
    });

    it("passes a valid body through with validatedBody set", async () => {
        const { ctx, vars, json } = mockContext({
            path: "/intel/site-audit",
            body: JSON.stringify({ url: "https://example.com" }),
        });
        const next = vi.fn(async () => { /* handler */ });

        await run(ctx, next);

        expect(next).toHaveBeenCalledOnce();
        expect(json).not.toHaveBeenCalled();
        expect(vars.get("validatedBody")).toEqual({ url: "https://example.com" });
    });

    it("does not swallow downstream errors as INVALID_JSON", async () => {
        const { ctx } = mockContext({
            path: "/intel/site-audit",
            body: JSON.stringify({ url: "https://example.com" }),
        });
        const boom = new Error("handler exploded");
        const next = vi.fn(() => Promise.reject(boom));

        await expect(run(ctx, next)).rejects.toThrow("handler exploded");
    });
});
