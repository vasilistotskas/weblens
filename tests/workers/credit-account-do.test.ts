/// <reference types="@cloudflare/vitest-pool-workers" />
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, it, expect } from "vitest";

// Real CreditAccountDO running in workerd (via @cloudflare/vitest-pool-workers).
// Storage is isolated per test file; each test uses a distinct wallet name so
// the DO instances (keyed by idFromName) don't collide.

function stubFor(wallet: string) {
    const ns = (env as unknown as { CREDIT_MANAGER: DurableObjectNamespace }).CREDIT_MANAGER;
    return ns.get(ns.idFromName(wallet));
}

function call(wallet: string, p: string, method: "GET" | "POST", body?: unknown) {
    const init: RequestInit = { method };
    if (body !== undefined) {
        init.body = JSON.stringify(body);
        init.headers = { "Content-Type": "application/json" };
    }
    return stubFor(wallet).fetch(`https://do${p}`, init);
}

describe("CreditAccountDO (real workerd binding)", () => {
    it("deposits and reflects the balance", async () => {
        const dep = await call("0xdeposit", "/deposit", "POST", { amount: 10, description: "seed" });
        expect(dep.status).toBe(200);
        expect(await dep.json()).toMatchObject({ success: true, balance: 10 });

        const bal = await call("0xdeposit", "/balance", "GET");
        expect(await bal.json()).toMatchObject({ balance: 10, totalDeposited: 10 });
    });

    it("spends and rejects overspend with 402 (no balance change)", async () => {
        await call("0xspend", "/deposit", "POST", { amount: 5 });

        const ok = await call("0xspend", "/spend", "POST", { amount: 2, description: "fetch" });
        expect(ok.status).toBe(200);
        expect(await ok.json()).toMatchObject({ success: true, balance: 3 });

        const over = await call("0xspend", "/spend", "POST", { amount: 100, description: "too much" });
        expect(over.status).toBe(402);
        expect(await over.json()).toMatchObject({ error: "Insufficient funds" });

        const bal = await call("0xspend", "/balance", "GET");
        expect(await bal.json()).toMatchObject({ balance: 3, totalSpent: 2 });
    });

    it("is idempotent on deposit externalId (no double credit)", async () => {
        const first = await call("0xdedup", "/deposit", "POST", { amount: 7, externalId: "tx-abc" });
        expect(await first.json()).toMatchObject({ success: true, balance: 7 });

        const replay = await call("0xdedup", "/deposit", "POST", { amount: 7, externalId: "tx-abc" });
        expect(await replay.json()).toMatchObject({ duplicate: true, balance: 7 });

        const bal = await call("0xdedup", "/balance", "GET");
        expect(await bal.json()).toMatchObject({ balance: 7 });
    });

    it("refund reverses a spend (unwinds totalSpent, not totalDeposited)", async () => {
        await call("0xrefund", "/deposit", "POST", { amount: 10 });
        await call("0xrefund", "/spend", "POST", { amount: 4, description: "x" });

        const refund = await call("0xrefund", "/refund", "POST", { amount: 4, externalId: "r-1" });
        expect(await refund.json()).toMatchObject({ success: true, balance: 10 });

        const bal = await call("0xrefund", "/balance", "GET");
        expect(await bal.json()).toMatchObject({ balance: 10, totalDeposited: 10, totalSpent: 0 });
    });

    it("crosses the premium tier threshold at $100 deposited", async () => {
        await call("0xtier", "/deposit", "POST", { amount: 100 });
        const bal = await call("0xtier", "/balance", "GET");
        expect(await bal.json()).toMatchObject({ tier: "premium" });
    });

    it("exposes internal storage via runInDurableObject", async () => {
        await call("0xinternal", "/deposit", "POST", { amount: 3 });
        await runInDurableObject(stubFor("0xinternal"), async (_instance, state) => {
            const account = await state.storage.get<{ balance: number }>("account");
            expect(account).toMatchObject({ balance: 3 });
        });
    });
});
