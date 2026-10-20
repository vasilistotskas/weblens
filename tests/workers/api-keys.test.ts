/// <reference types="@cloudflare/vitest-plugin/types" />
/**
 * Paying for a paid route with a prepaid API key, through the real Worker:
 * the debit, the refund on failure, and every way a key is refused.
 */
import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRICING } from "../../src/config";
import { formatApiKey, newAccountId } from "../../src/services/accounts";
import type { Env } from "../../src/types";

const ORIGIN = "https://api.weblens.dev";
const workerEnv = env as unknown as Env;
const PAGE = "<html><head><title>Example</title></head><body><p>Example page</p></body></html>";

/** A funded account and its key, as a buyer would hold it after checkout. */
async function fundedKey(micros: number): Promise<{ accountId: string; key: string; secret: string }> {
    const accountId = newAccountId();
    const account = workerEnv.ACCOUNTS.getByName(accountId);
    await account.deposit(`cs_test_${accountId}`, micros, "seed");
    const secret = await account.issueFirstKey();
    if (secret === null) { throw new Error("no key issued"); }
    return { accountId, secret, key: formatApiKey(workerEnv.API_KEY_PREFIX, accountId, secret) };
}

async function balanceOf(accountId: string, secret: string): Promise<number | undefined> {
    return (await workerEnv.ACCOUNTS.getByName(accountId).summary(secret))?.balanceMicros;
}

function fetchBasic(headers: Record<string, string>, body: unknown = { url: "https://example.com/", cache: false }) {
    return SELF.fetch(`${ORIGIN}/fetch/basic`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
    });
}

let targetStatus = 200;
beforeEach(() => {
    targetStatus = 200;
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        Promise.resolve(new Response(PAGE, { status: targetStatus, headers: { "Content-Type": "text/html; charset=utf-8" } })));
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe("paying with an API key", () => {
    it("debits the list price, without the x402 floor, and serves the call", async () => {
        const { accountId, key, secret } = await fundedKey(1_000_000);
        const res = await fetchBasic({ Authorization: `Bearer ${key}` });

        expect(res.status).toBe(200);
        expect(res.headers.get("PAYMENT-REQUIRED")).toBeNull();
        expect(res.headers.get("Payment-Method")).toBe("Credits");
        // $0.002 list price; an x402 payment of the same call would be charged the $0.004 floor.
        expect(res.headers.get("Credit-Cost")).toBe(PRICING.fetch.basic);
        expect(res.headers.get("Credit-Balance")).toBe("$0.998");
        expect(await balanceOf(accountId, secret)).toBe(998_000);
    });

    it("refunds a call that fails", async () => {
        const { accountId, key, secret } = await fundedKey(1_000_000);
        targetStatus = 500;
        const res = await fetchBasic({ Authorization: `Bearer ${key}` });

        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.headers.get("Credit-Refunded")).toBe(PRICING.fetch.basic);
        expect(await balanceOf(accountId, secret)).toBe(1_000_000);
    });

    it("answers a short balance with 402 INSUFFICIENT_CREDITS, not an x402 challenge", async () => {
        const { key } = await fundedKey(1_000);
        const res = await fetchBasic({ Authorization: `Bearer ${key}` });
        const body = await res.json<Record<string, unknown>>();

        expect(res.status).toBe(402);
        expect(res.headers.get("PAYMENT-REQUIRED")).toBeNull();
        expect(body).toMatchObject({ code: "INSUFFICIENT_CREDITS", price: PRICING.fetch.basic, balance: "$0.001" });
        expect(body.topUp).toBe(`${ORIGIN}/billing/checkout`);
    });

    it("validates the body strictly before charging a key", async () => {
        const { accountId, key, secret } = await fundedKey(1_000_000);
        const res = await fetchBasic({ Authorization: `Bearer ${key}` }, { url: 42 });

        expect(res.status).toBe(400);
        expect(await balanceOf(accountId, secret)).toBe(1_000_000);
    });

    it.each([
        ["a non-bearer header", "Basic dXNlcjpwYXNz"],
        ["a malformed key", "Bearer wl_live_short"],
        ["a testnet key in production", `Bearer wl_test_${"0".repeat(32)}_${"A".repeat(43)}`],
        ["a key of no account", `Bearer wl_live_${"0".repeat(32)}_${"A".repeat(43)}`],
    ])("refuses %s with 401, never falling through to x402", async (_label, authorization) => {
        const res = await fetchBasic({ Authorization: authorization });
        expect(res.status).toBe(401);
        expect(await res.json<Record<string, unknown>>()).toMatchObject({ code: "INVALID_API_KEY" });
    });
});

describe("the account a key opens", () => {
    it("shows the balance and ledger to the key holder only", async () => {
        const { key } = await fundedKey(10_000_000);
        await fetchBasic({ Authorization: `Bearer ${key}` });

        const res = await SELF.fetch(`${ORIGIN}/account`, { headers: { Authorization: `Bearer ${key}` } });
        const body = await res.json<{ balance: string; recent: { kind: string; amount: string }[] }>();
        expect(res.status).toBe(200);
        expect(res.headers.get("Cache-Control")).toBe("no-store");
        expect(body.balance).toBe("$9.998");
        expect(body.recent.map((entry) => [entry.kind, entry.amount])).toEqual([["spend", "$0.002"], ["deposit", "$10"]]);

        expect((await SELF.fetch(`${ORIGIN}/account`)).status).toBe(401);
    });

    it("rotates the key: the old one stops working at once", async () => {
        const { key } = await fundedKey(1_000_000);
        const res = await SELF.fetch(`${ORIGIN}/account/key/rotate`, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "cf-connecting-ip": "203.0.113.70" },
        });
        const { apiKey } = await res.json<{ apiKey: string }>();

        expect(res.status).toBe(200);
        expect(apiKey).toMatch(/^wl_live_[0-9a-f]{32}_[A-Za-z0-9_-]{43}$/u);
        expect((await fetchBasic({ Authorization: `Bearer ${key}` })).status).toBe(401);
        expect((await fetchBasic({ Authorization: `Bearer ${apiKey}` })).status).toBe(200);
    });
});
