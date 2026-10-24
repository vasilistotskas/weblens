/**
 * Unauthenticated probes of paid endpoints must reach the x402 payment
 * middleware (402) instead of being rejected with a 400.
 *
 * Production evidence: 170 bare POSTs to /intel/site-audit bounced as 400,
 * so probing agents concluded the resource was not payable. x402scan
 * documents this exact failure as "Expected 402, got 400".
 *
 * Requests that pay (x402 or an API key) keep strict validation — money must
 * never move on an invalid body.
 */

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validateRequest } from "../../src/middleware/validation";
import type { AppEnv } from "../../src/types";
import { createLogger } from "../../src/utils/logger";

const schema = z.object({ url: z.url() });

interface CallOptions {
    body?: string;
    /** null sets none, so fetch labels a string body text/plain. */
    contentType?: string | null;
    headers?: Record<string, string>;
    /** What runs after validation: the payment middleware for a probe, the handler otherwise. */
    next?: () => never;
}

/** POST `path` through the real middleware; `reached` says whether it let the request on. */
async function post(path: string, { body = "{}", contentType = "application/json", headers = {}, next }: CallOptions = {}) {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, nextMiddleware) => {
        c.set("log", createLogger("silent"));
        await nextMiddleware();
    });
    app.post("*", validateRequest(schema), (c) => {
        if (next) { next(); }
        return c.json({ reached: true, validatedBody: c.get("validatedBody") ?? null });
    });
    app.onError((err, c) => c.json({ thrown: err.message }, 500));

    const all: Record<string, string> = { ...headers };
    if (contentType !== null) { all["Content-Type"] = contentType; }
    const res = await app.request(`https://api.weblens.dev${path}`, { method: "POST", body, headers: all }, { API_KEY_PREFIX: "wl_live_" });
    const json = await res.json<{ reached?: boolean; validatedBody?: unknown; thrown?: string }>();
    return { status: res.status, reached: json.reached === true, json };
}

describe("validateRequest — unpaid probe fallthrough", () => {
    it("lets an unpaid probe with an invalid body reach the payment middleware", async () => {
        expect(await post("/domain")).toMatchObject({ status: 200, reached: true });
    });

    it("lets an unpaid probe without a JSON content type through", async () => {
        expect(await post("/search/news", { contentType: null })).toMatchObject({ status: 200, reached: true });
    });

    it("lets an unpaid probe with malformed JSON through", async () => {
        expect(await post("/answer", { body: "not json{" })).toMatchObject({ status: 200, reached: true });
    });

    it("still rejects an invalid body when the request carries an x402 payment", async () => {
        expect(await post("/domain", { headers: { "Payment-Signature": "0xdeadbeef" } })).toMatchObject({ status: 400, reached: false });
    });

    it("lets a probe carrying someone else's Authorization (an MCP client login) reach the 402", async () => {
        const result = await post("/domain", { headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiIs.payload.sig" } });
        expect(result).toMatchObject({ status: 200, reached: true });
    });

    it("still rejects an invalid body when the request carries an API key", async () => {
        expect(await post("/contents", { headers: { Authorization: "Bearer wl_live_key" } })).toMatchObject({ status: 400, reached: false });
    });

    it("still rejects invalid bodies on non-paid routes", async () => {
        expect(await post("/free/fetch")).toMatchObject({ status: 400, reached: false });
    });

    it("enforces the body-size cap even for probes", async () => {
        const result = await post("/contents", { headers: { "Content-Length": String(300 * 1024) } });
        expect(result).toMatchObject({ status: 413, reached: false });
    });

    it("passes a valid body through with validatedBody set", async () => {
        const result = await post("/domain", { body: JSON.stringify({ url: "https://example.com" }) });
        expect(result).toMatchObject({ status: 200, reached: true, json: { validatedBody: { url: "https://example.com" } } });
    });

    it("does not swallow downstream errors as INVALID_JSON", async () => {
        const result = await post("/domain", {
            body: JSON.stringify({ url: "https://example.com" }),
            next: () => { throw new Error("handler exploded"); },
        });
        expect(result).toMatchObject({ status: 500, json: { thrown: "handler exploded" } });
    });
});
