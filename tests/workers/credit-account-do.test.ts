/**
 * The prepaid account ledger, in a real CreditAccountDO running in workerd.
 * Storage is isolated per test file; each test uses its own account name.
 */
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { CreditAccountDO } from "../../src/durable_objects/CreditAccountDO";

const accounts = env.ACCOUNTS;
const stub = (name: string) => accounts.getByName(name);

/** An account with `micros` deposited and its first key issued. */
async function funded(name: string, micros: number): Promise<{ account: DurableObjectStub<CreditAccountDO>; secret: string }> {
    const account = stub(name);
    await account.deposit(`cs_test_${name}`, micros, "seed");
    const secret = await account.issueFirstKey();
    if (secret === null) { throw new Error("no key issued"); }
    return { account, secret };
}

describe("CreditAccountDO ledger", () => {
    it("credits a deposit once per external id", async () => {
        const account = stub("deposit-once");
        expect(await account.deposit("cs_test_a", 10_000_000, "pack")).toEqual({ balanceMicros: 10_000_000, duplicate: false });
        // Stripe's webhook and the success page fulfil the same session.
        expect(await account.deposit("cs_test_a", 10_000_000, "pack")).toEqual({ balanceMicros: 10_000_000, duplicate: true });
        expect(await account.deposit("cs_test_b", 50_000_000, "pack")).toEqual({ balanceMicros: 60_000_000, duplicate: false });
    });

    // assertMicros itself is tested in tests/unit/api-keys.test.ts: a throw inside the object is printed by
    // workerd as an uncaught exception before RPC hands it back, so it is not provoked here.
    it("cannot record a zero or negative amount even through SQL", async () => {
        const { account } = await funded("ledger-check", 1_000);
        await expect(runInDurableObject(account, (_instance, state) =>
            state.storage.sql.exec("INSERT INTO ledger (kind, amount_micros, external_id, description, created_at) VALUES ('deposit', 0, 'x', 'x', 'x')")))
            .rejects.toThrow(/CHECK constraint/u);
    });

    it("issues the first key once, and only to an account that exists", async () => {
        expect(await stub("never-funded").issueFirstKey()).toBeNull();
        const account = stub("first-key");
        await account.deposit("cs_test_fk", 1_000_000, "seed");
        const secret = await account.issueFirstKey();
        expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/u);
        expect(await account.issueFirstKey()).toBeNull();
    });

    it("stores only a hash of the key", async () => {
        const { account, secret } = await funded("hash-only", 1_000_000);
        const stored = await runInDurableObject(account, (_instance, state) =>
            state.storage.sql.exec<{ secret_hash: string }>("SELECT secret_hash FROM api_keys").toArray());
        expect(stored).toHaveLength(1);
        expect(stored[0]?.secret_hash).toMatch(/^[0-9a-f]{64}$/u);
        expect(stored[0]?.secret_hash).not.toContain(secret);
    });

    it("debits an active key and refuses a wrong one", async () => {
        const { account, secret } = await funded("spend", 1_000_000);
        expect(await account.spend(secret, 15_000, "req-1", "Search")).toEqual({ ok: true, balanceMicros: 985_000 });
        const wrong = `${secret.slice(0, -1)}${secret.endsWith("A") ? "B" : "A"}`;
        expect(await account.spend(wrong, 15_000, "req-2", "Search")).toEqual({ ok: false, reason: "invalid_key" });
    });

    it("never charges a request id twice", async () => {
        const { account, secret } = await funded("replay", 1_000_000);
        await account.spend(secret, 15_000, "req-same", "Search");
        expect(await account.spend(secret, 15_000, "req-same", "Search")).toEqual({ ok: true, balanceMicros: 985_000 });
    });

    it("refuses an overspend without moving money", async () => {
        const { account, secret } = await funded("overspend", 10_000);
        expect(await account.spend(secret, 15_000, "req-big", "Search")).toEqual({ ok: false, reason: "insufficient_balance", balanceMicros: 10_000 });
        expect((await account.summary(secret))?.balanceMicros).toBe(10_000);
    });

    it("refunds what the ledger charged, once", async () => {
        const { account, secret } = await funded("refund", 1_000_000);
        await account.spend(secret, 50_000, "req-r", "Company");
        expect(await account.refund("req-r")).toEqual({ refundedMicros: 50_000 });
        expect(await account.refund("req-r")).toEqual({ refundedMicros: 0 });
        expect(await account.refund("req-never-charged")).toEqual({ refundedMicros: 0 });
        const summary = await account.summary(secret);
        expect(summary?.balanceMicros).toBe(1_000_000);
        expect(summary?.recent.map((entry) => [entry.kind, entry.amountMicros])).toEqual([
            ["refund", 50_000],
            ["spend", 50_000],
            ["deposit", 1_000_000],
        ]);
    });

    it("rotates a key: the old one stops at once, the new one works", async () => {
        const { account, secret } = await funded("rotate", 1_000_000);
        const replacement = await account.rotateKey(secret);
        expect(replacement).toMatch(/^[A-Za-z0-9_-]{43}$/u);
        expect(await account.spend(secret, 1_000, "req-old", "x")).toEqual({ ok: false, reason: "invalid_key" });
        expect(await account.spend(replacement ?? "", 1_000, "req-new", "x")).toMatchObject({ ok: true });
        expect(await account.rotateKey(secret)).toBeNull();
    });

    it("answers for the key holder only", async () => {
        const { account } = await funded("summary", 1_000_000);
        expect(await account.summary("A".repeat(43))).toBeNull();
    });

    it("stores nothing for a forged account id", async () => {
        const forged = stub("forged-account");
        expect(await forged.spend("A".repeat(43), 1_000, "req-f", "x")).toEqual({ ok: false, reason: "invalid_key" });
        expect(await forged.summary("A".repeat(43))).toBeNull();
        expect(await forged.refund("req-f")).toEqual({ refundedMicros: 0 });
        const tables = await runInDurableObject(forged, (_instance, state) =>
            state.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf%' ESCAPE '\\'").toArray());
        expect(tables).toEqual([]);
    });

    it("cannot overdraw even through SQL: the balance has a CHECK constraint", async () => {
        const { account } = await funded("constraint", 1_000);
        await expect(runInDurableObject(account, (_instance, state) =>
            state.storage.sql.exec("UPDATE account SET balance_micros = -1 WHERE id = 1"))).rejects.toThrow(/CHECK constraint/u);
    });
});

describe("CreditAccountDO reversals", () => {
    it("reverses a refund up to its cumulative target, once, and keeps the key while credit remains", async () => {
        const { account, secret } = await funded("reverse-partial", 10_000_000);
        await account.deposit("cs_test_more", 50_000_000, "pack");

        expect(await account.reverseDeposit("cs_test_reverse-partial", 4_000_000, "refund")).toEqual({ reversedMicros: 4_000_000, shortfallMicros: 0, keysRevoked: false });
        // A replay of the same cumulative refund reverses nothing more; a larger one only the difference.
        expect(await account.reverseDeposit("cs_test_reverse-partial", 4_000_000, "refund")).toEqual({ reversedMicros: 0, shortfallMicros: 0, keysRevoked: false });
        expect(await account.reverseDeposit("cs_test_reverse-partial", 99_000_000, "refund")).toEqual({ reversedMicros: 6_000_000, shortfallMicros: 0, keysRevoked: false });
        expect((await account.summary(secret))?.balanceMicros).toBe(50_000_000);
    });

    it("records spent credit as a shortfall and revokes every key", async () => {
        const { account, secret } = await funded("reverse-spent", 10_000_000);
        await account.spend(secret, 7_000_000, "req_1", "calls");

        expect(await account.reverseDeposit("cs_test_reverse-spent", 10_000_000, "refund")).toEqual({ reversedMicros: 3_000_000, shortfallMicros: 7_000_000, keysRevoked: true });
        expect(await account.summary(secret)).toBeNull();
        // Redelivered, it owes nothing more and moves nothing.
        expect(await account.reverseDeposit("cs_test_reverse-spent", 10_000_000, "refund")).toEqual({ reversedMicros: 0, shortfallMicros: 0, keysRevoked: false });
    });

    it("revokes the keys on a dispute even when credit remains", async () => {
        const { account, secret } = await funded("reverse-dispute", 10_000_000);
        await account.deposit("cs_test_other", 50_000_000, "pack");

        expect(await account.reverseDeposit("cs_test_reverse-dispute", 10_000_000, "dispute")).toEqual({ reversedMicros: 10_000_000, shortfallMicros: 0, keysRevoked: true });
        expect(await account.summary(secret)).toBeNull();
    });

    it("reverses nothing for a deposit the account never received", async () => {
        const { account } = await funded("reverse-unknown", 10_000_000);
        expect(await account.reverseDeposit("cs_test_not_here", 10_000_000, "dispute")).toEqual({ reversedMicros: 0, shortfallMicros: 0, keysRevoked: false });
        expect(await stub("reverse-never-created").reverseDeposit("cs_test_x", 10_000_000, "refund")).toEqual({ reversedMicros: 0, shortfallMicros: 0, keysRevoked: false });
    });
});
