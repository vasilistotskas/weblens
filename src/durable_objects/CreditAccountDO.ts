/**
 * One prepaid account: its balance, its API keys and its ledger, in the
 * Durable Object's own SQLite database. The Worker addresses an account by the
 * id embedded in its API key (`env.ACCOUNTS.getByName(accountId)`) and calls
 * the RPC methods below.
 *
 * Money is integer micro-USD (1 USD = 1,000,000), never a float. Every ledger
 * row carries a unique `external_id` (the Stripe Checkout Session for a
 * deposit, the request id for a spend and its refund), so a replayed deposit,
 * spend or refund is answered from the ledger instead of moving money twice.
 * Each method's read-check-write runs in one `transactionSync`, and the
 * `CHECK (balance_micros >= 0)` constraint makes an overdraft impossible even
 * if a code path forgot the check.
 *
 * Only a deposit creates the tables. A forged key names a random account id,
 * and a write on that path would leave a stored object behind for every
 * forged call; every other method first checks that the account exists, which
 * writes nothing.
 */

import { DurableObject } from "cloudflare:workers";
import type { Env } from "../types";

/** How many ledger rows `summary()` returns, newest first. */
const RECENT_LEDGER_ROWS = 50;

/** Random bytes in an API key's secret part (256 bits). */
const SECRET_BYTES = 32;

export type LedgerKind = "deposit" | "spend" | "refund";

export interface LedgerEntry {
    kind: LedgerKind;
    amountMicros: number;
    description: string;
    createdAt: string;
}

export interface AccountSummary {
    balanceMicros: number;
    createdAt: string;
    keyCreatedAt: string;
    recent: LedgerEntry[];
}

export type SpendResult =
    | { ok: true; balanceMicros: number }
    | { ok: false; reason: "invalid_key" }
    | { ok: false; reason: "insufficient_balance"; balanceMicros: number };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS account (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    balance_micros INTEGER NOT NULL CHECK (balance_micros >= 0),
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY,
    secret_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('deposit', 'spend', 'refund')),
    amount_micros INTEGER NOT NULL CHECK (amount_micros > 0),
    external_id TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    created_at TEXT NOT NULL
);`;

export function assertMicros(micros: number): void {
    if (!Number.isSafeInteger(micros) || micros <= 0) {
        throw new RangeError(`amount must be a positive whole number of micro-USD, got ${String(micros)}`);
    }
}

/** SHA-256 of an API key secret, hex. Only this is stored; the secret is shown to the buyer once. */
async function hashSecret(secret: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function newSecret(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

export class CreditAccountDO extends DurableObject<Env> {
    private get sql(): SqlStorage {
        return this.ctx.storage.sql;
    }

    private exists(): boolean {
        return this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'account'").toArray().length > 0;
    }

    private balance(): number {
        return this.sql.exec<{ balance_micros: number }>("SELECT balance_micros FROM account WHERE id = 1").one().balance_micros;
    }

    /** The active key whose secret hashes to `hash`, or undefined. */
    private activeKeyId(hash: string): number | undefined {
        return this.sql.exec<{ id: number }>(
            "SELECT id FROM api_keys WHERE secret_hash = ? AND revoked_at IS NULL", hash,
        ).toArray()[0]?.id;
    }

    private recorded(externalId: string): boolean {
        return this.sql.exec("SELECT 1 FROM ledger WHERE external_id = ?", externalId).toArray().length > 0;
    }

    private record(kind: LedgerKind, micros: number, externalId: string, description: string, now: string): void {
        this.sql.exec(
            "INSERT INTO ledger (kind, amount_micros, external_id, description, created_at) VALUES (?, ?, ?, ?, ?)",
            kind, micros, externalId, description, now,
        );
    }

    /**
     * Credit a paid purchase. `externalId` is the Checkout Session id: Stripe's webhook and the success
     * page both fulfil the same session, possibly at once, and only the first one adds money.
     */
    deposit(externalId: string, micros: number, description: string): { balanceMicros: number; duplicate: boolean } {
        assertMicros(micros);
        return this.ctx.storage.transactionSync(() => {
            const now = new Date().toISOString();
            this.sql.exec(SCHEMA);
            this.sql.exec("INSERT OR IGNORE INTO account (id, balance_micros, created_at) VALUES (1, 0, ?)", now);
            if (this.recorded(externalId)) {
                return { balanceMicros: this.balance(), duplicate: true };
            }
            this.sql.exec("UPDATE account SET balance_micros = balance_micros + ? WHERE id = 1", micros);
            this.record("deposit", micros, externalId, description, now);
            return { balanceMicros: this.balance(), duplicate: false };
        });
    }

    /**
     * The account's first API key, returned once. Null when the account does not exist or already has
     * a key: a key is shown only to whoever completes the purchase that opened the account.
     */
    async issueFirstKey(): Promise<string | null> {
        const secret = newSecret();
        const hash = await hashSecret(secret);
        return this.ctx.storage.transactionSync(() => {
            if (!this.exists()) { return null; }
            if (this.sql.exec("SELECT 1 FROM api_keys").toArray().length > 0) { return null; }
            this.sql.exec("INSERT INTO api_keys (secret_hash, created_at) VALUES (?, ?)", hash, new Date().toISOString());
            return secret;
        });
    }

    /** Debit `micros` for request `requestId` when `secret` is an active key. A replayed request id is not charged twice. */
    async spend(secret: string, micros: number, requestId: string, description: string): Promise<SpendResult> {
        assertMicros(micros);
        const hash = await hashSecret(secret);
        return this.ctx.storage.transactionSync((): SpendResult => {
            if (!this.exists()) { return { ok: false, reason: "invalid_key" }; }
            const keyId = this.activeKeyId(hash);
            if (keyId === undefined) { return { ok: false, reason: "invalid_key" }; }
            const externalId = `spend:${requestId}`;
            if (this.recorded(externalId)) { return { ok: true, balanceMicros: this.balance() }; }
            const balanceMicros = this.balance();
            if (balanceMicros < micros) { return { ok: false, reason: "insufficient_balance", balanceMicros }; }
            const now = new Date().toISOString();
            this.sql.exec("UPDATE account SET balance_micros = balance_micros - ? WHERE id = 1", micros);
            this.record("spend", micros, externalId, description, now);
            this.sql.exec("UPDATE api_keys SET last_used_at = ? WHERE id = ?", now, keyId);
            return { ok: true, balanceMicros: this.balance() };
        });
    }

    /**
     * Give back what request `requestId` was charged. The amount comes from the ledger, never from the
     * caller, and a second refund for the same request changes nothing.
     */
    refund(requestId: string): { refundedMicros: number } {
        return this.ctx.storage.transactionSync(() => {
            if (!this.exists()) { return { refundedMicros: 0 }; }
            const charged = this.sql.exec<{ amount_micros: number; description: string }>(
                "SELECT amount_micros, description FROM ledger WHERE external_id = ?", `spend:${requestId}`,
            ).toArray()[0];
            const externalId = `refund:${requestId}`;
            if (!charged || this.recorded(externalId)) { return { refundedMicros: 0 }; }
            this.sql.exec("UPDATE account SET balance_micros = balance_micros + ? WHERE id = 1", charged.amount_micros);
            this.record("refund", charged.amount_micros, externalId, `Refund: ${charged.description}`, new Date().toISOString());
            return { refundedMicros: charged.amount_micros };
        });
    }

    /** Balance and recent ledger for the holder of an active key; null for anyone else. */
    async summary(secret: string): Promise<AccountSummary | null> {
        const hash = await hashSecret(secret);
        return this.ctx.storage.transactionSync((): AccountSummary | null => {
            if (!this.exists()) { return null; }
            const key = this.sql.exec<{ created_at: string }>(
                "SELECT created_at FROM api_keys WHERE secret_hash = ? AND revoked_at IS NULL", hash,
            ).toArray()[0];
            if (!key) { return null; }
            const account = this.sql.exec<{ balance_micros: number; created_at: string }>(
                "SELECT balance_micros, created_at FROM account WHERE id = 1",
            ).one();
            const recent = this.sql.exec<{ kind: LedgerKind; amount_micros: number; description: string; created_at: string }>(
                "SELECT kind, amount_micros, description, created_at FROM ledger ORDER BY id DESC LIMIT ?", RECENT_LEDGER_ROWS,
            ).toArray().map((row) => ({
                kind: row.kind,
                amountMicros: row.amount_micros,
                description: row.description,
                createdAt: row.created_at,
            }));
            return { balanceMicros: account.balance_micros, createdAt: account.created_at, keyCreatedAt: key.created_at, recent };
        });
    }

    /** Replace the key `secret` with a new one, returned once; the old key stops working at once. */
    async rotateKey(secret: string): Promise<string | null> {
        const [hash, replacement] = [await hashSecret(secret), newSecret()];
        const replacementHash = await hashSecret(replacement);
        return this.ctx.storage.transactionSync(() => {
            if (!this.exists()) { return null; }
            const keyId = this.activeKeyId(hash);
            if (keyId === undefined) { return null; }
            const now = new Date().toISOString();
            this.sql.exec("UPDATE api_keys SET revoked_at = ? WHERE id = ?", now, keyId);
            this.sql.exec("INSERT INTO api_keys (secret_hash, created_at) VALUES (?, ?)", replacementHash, now);
            return replacement;
        });
    }
}
