/**
 * POST /feedback in the real runtime.
 *
 * This is the one endpoint that accepts an arbitrary buyer-authored JSON
 * document and hashes it, so its whole middleware chain (rate limit →
 * validation → handler) is worth exercising end to end rather than unit
 * testing the schema alone. Each case below was a live 500 or an unbounded
 * accept in production before the chain was completed.
 *
 * Every request carries its own cf-connecting-ip: the limiter buckets by
 * that header, so distinct IPs keep these cases independent.
 */

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { keccak256, stringToHex } from "viem";

const VALID = {
    agentRegistry: "eip155:8453:0x0000000000000000000000000000000000000000",
    agentId: "42",
    clientAddress: "0x1234567890abcdef1234567890abcdef12345678",
    createdAt: "2026-07-31T12:00:00.000Z",
    value: 95,
    valueDecimals: 0,
};

let ipCounter = 0;
function post(body: string, headers: Record<string, string> = {}) {
    ipCounter++;
    return SELF.fetch("https://api.weblens.dev/feedback", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": `10.9.0.${String(ipCounter)}`,
            ...headers,
        },
        body,
    });
}

describe("POST /feedback", () => {
    it("hosts a valid document and returns a reproducible hash", async () => {
        const res = await post(JSON.stringify(VALID));
        expect(res.status).toBe(201);

        const hosted = await res.json<{ feedbackURI: string; feedbackHash: string }>();
        expect(hosted.feedbackHash).toMatch(/^0x[0-9a-f]{64}$/u);

        // The buyer's check: hash the bytes the feedbackURI serves.
        const served = await SELF.fetch(hosted.feedbackURI, {
            headers: { "cf-connecting-ip": "10.9.1.1" },
        });
        expect(served.status).toBe(200);
        expect(keccak256(stringToHex(await served.text()))).toBe(hosted.feedbackHash);
    });

    it("rejects a null body with 400, not a 500", async () => {
        // typeof null === "object", so the hand-rolled object guard passed it
        // through and the first field read threw.
        const res = await post("null");
        expect(res.status).toBe(400);
        expect((await res.json<{ code: string }>()).code).toBe("VALIDATION_ERROR");
    });

    it("rejects arrays and scalars", async () => {
        for (const body of ["[]", '"hello"', "42"]) {
            const res = await post(body);
            expect(res.status, `body ${body}`).toBe(400);
        }
    });

    it("rejects a body over the shared 256KB limit", async () => {
        // Accepted at 900KB and written to KV for 30 days before validation
        // was wired in — every other POST route capped this.
        const huge = JSON.stringify({ ...VALID, pad: "x".repeat(900_000) });
        const res = await post(huge, { "Content-Length": String(huge.length) });
        expect(res.status).toBe(413);
    });

    it("rejects nesting deep enough to exhaust the hasher's stack", async () => {
        // 10KB of body was enough to overflow canonicalJson's recursion.
        let deep: unknown = 1;
        for (let i = 0; i < 5000; i++) { deep = [deep]; }
        const res = await post(JSON.stringify({ ...VALID, deep }));
        expect(res.status).toBe(400);
    });

    it("still accepts a wide document — width is not depth", async () => {
        const wide = { ...VALID, items: Array.from({ length: 200 }, (_, i) => ({ i })) };
        const res = await post(JSON.stringify(wide));
        expect(res.status).toBe(201);
    });

    it("names every missing required field", async () => {
        const res = await post(JSON.stringify({ agentId: "1" }));
        expect(res.status).toBe(400);
        const { message } = await res.json<{ message: string }>();
        for (const field of ["agentRegistry", "clientAddress", "createdAt", "value", "valueDecimals"]) {
            expect(message, `should name ${field}`).toContain(field);
        }
    });

    it("preserves unknown fields, since they are part of what is hashed", async () => {
        const custom = { ...VALID, tag1: "quality", nested: { note: "kept" } };
        const res = await post(JSON.stringify(custom));
        const hosted = await res.json<{ feedbackURI: string }>();

        const served = await SELF.fetch(hosted.feedbackURI, {
            headers: { "cf-connecting-ip": "10.9.1.2" },
        });
        const doc = await served.json<Record<string, unknown>>();
        expect(doc.tag1).toBe("quality");
        expect(doc.nested).toEqual({ note: "kept" });
    });
});
