/**
 * Seed CDP Bazaar listings by settling real x402 payments through the CDP
 * facilitator, one per resource.
 *
 * Why this exists, precisely: CDP's Bazaar has no registration call. A resource
 * enters the catalog only after the **CDP facilitator itself** settles a payment
 * for it, and indexing is **per-resource** — see
 * https://docs.cdp.coinbase.com/x402/seller/get-discovered ("Complete a
 * successful paid call through the CDP Facilitator"). WebLens routes normal
 * traffic through PayAI (PayAI is primary in `getResourceServer`, because CDP's
 * Base-mainnet /settle is still unreliable — x402-foundation/x402#1065), so
 * ordinary buyer payments — including the two real ones in Aug 2026 — are
 * settled by PayAI and never reach CDP. That is why WebLens passes 25/25 of
 * CDP's `/validate` checks yet reports `index: null`.
 *
 * So this script sends `X-Bazaar-Bootstrap: $BAZAAR_BOOTSTRAP_SECRET`, which
 * flips that single request to CDP-primary (see `wantsCdpBootstrap`). Nothing
 * about other buyers' traffic changes.
 *
 * The catalog record is written at settle time, so `serviceName`/`tags`/
 * `iconUrl` must already be deployed before seeding — refreshing them later
 * costs another payment per route.
 *
 * Safety: this spends real USDC, so it PLANS by default and pays only with
 * CONFIRM=yes. Per-endpoint prices are read from each endpoint's own 402
 * challenge (never hardcoded), and both a per-endpoint and a total cap apply.
 *
 * Usage (bash):
 *   # 1. see what it would cost, pay nothing
 *   BAZAAR_BOOTSTRAP_SECRET=... PRIVATE_KEY=0x... pnpm run bootstrap-payment
 *   # 2. actually seed
 *   CONFIRM=yes BAZAAR_BOOTSTRAP_SECRET=... PRIVATE_KEY=0x... pnpm run bootstrap-payment
 *
 * Usage (PowerShell):
 *   $env:BAZAAR_BOOTSTRAP_SECRET='...' ; $env:PRIVATE_KEY='0x...' ; pnpm run bootstrap-payment
 *
 * Options:
 *   MAX_PRICE=0.02      Skip endpoints dearer than this, in USDC (default 0.02)
 *   MAX_TOTAL=1.00      Abort if the plan exceeds this total (default 1.00)
 *   ENDPOINTS=/a,/b     Seed exactly these paths, ignoring MAX_PRICE
 *   API_URL=...         Target (default https://api.weblens.dev)
 *   RETRIES=4           Attempts per endpoint; #1065 fails intermittently
 *
 * Prerequisites: the wallet needs USDC on Base mainnet plus a little ETH for
 * gas, and BAZAAR_BOOTSTRAP_SECRET must match the deployed Worker secret.
 */

import { x402Client, wrapAxiosWithPayment } from "@x402/axios";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import axios, { AxiosError } from "axios";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Buffer } from "node:buffer";
import { PAID_ENDPOINTS } from "../src/config";

const CDP_VALIDATE = "https://api.cdp.coinbase.com/platform/v2/x402/validate";

// Never self-pay these: /credits/buy just moves money into our own credit
// ledger, and it is a billing action rather than a data product worth listing.
const NEVER_SEED = new Set(["/credits/buy"]);

interface PaymentReceipt {
    transaction?: string;
    network?: string;
    payer?: string;
}

/** One `accepts` entry of an x402 v2 challenge. */
interface Accept {
    amount?: string;
    network?: string;
}

interface Challenge {
    accepts?: Accept[];
    extensions?: {
        bazaar?: { info?: { input?: { body?: Record<string, unknown> } } };
    };
}

interface Plan {
    path: string;
    /** Atomic USDC units (6 decimals). */
    amount: number;
    /** Request body taken from the endpoint's own bazaar input example. */
    body: Record<string, unknown>;
}

const usd = (atomic: number): string => `$${(atomic / 1e6).toFixed(4)}`;

function decodeB64Json(value: string): unknown {
    try {
        return JSON.parse(Buffer.from(value, "base64").toString());
    } catch {
        return null;
    }
}

/**
 * Read an endpoint's own 402 challenge to learn its price and a body that is
 * guaranteed to validate. Using the published bazaar example keeps this script
 * from duplicating prices or schemas that live in src/.
 */
async function probe(apiUrl: string, path: string): Promise<Plan | null> {
    try {
        await axios.post(`${apiUrl}${path}`, {}, { timeout: 30000 });
        console.log(`   ${path}: expected 402, got 2xx — skipping`);
        return null;
    } catch (err) {
        if (!(err instanceof AxiosError) || !err.response) {throw err;}
        if (err.response.status !== 402) {
            console.log(`   ${path}: expected 402, got ${String(err.response.status)} — skipping`);
            return null;
        }
        const header = err.response.headers["payment-required"] as string | undefined;
        const challenge = header ? decodeB64Json(header) as Challenge | null : null;
        if (!challenge) {
            console.log(`   ${path}: 402 without a decodable PAYMENT-REQUIRED header — skipping`);
            return null;
        }
        const amount = Number(challenge.accepts?.[0]?.amount ?? NaN);
        if (!Number.isFinite(amount)) {
            console.log(`   ${path}: challenge has no usable accepts[0].amount — skipping`);
            return null;
        }
        const body = challenge.extensions?.bazaar?.info?.input?.body;
        if (!body) {
            console.log(`   ${path}: no bazaar input example to build a valid body — skipping`);
            return null;
        }
        return { path, amount, body };
    }
}

/** True for the intermittent CDP Base-mainnet settle failure (#1065). */
function isRetryableSettleError(err: unknown): boolean {
    const text = err instanceof AxiosError
        ? JSON.stringify(err.response?.data ?? err.message)
        : String(err);
    return /unable to estimate gas|gas required exceeds|settle.*failed|timeout/i.test(text);
}

async function seed(
    apiUrl: string,
    plan: Plan,
    secret: string,
    account: ReturnType<typeof privateKeyToAccount>,
    retries: number
): Promise<{ ok: boolean; tx?: string; bazaar?: string; detail?: string }> {
    for (let attempt = 1; attempt <= retries; attempt++) {
        // A fresh client per attempt: the payment wrapper latches scheme state,
        // and a failed settle must not poison the retry.
        const x402 = new x402Client();
        registerExactEvmScheme(x402, { signer: account });
        const client = wrapAxiosWithPayment(
            axios.create({ baseURL: apiUrl, timeout: 120000 }),
            x402
        );

        try {
            const res = await client.post(plan.path, plan.body, {
                headers: { "X-Bazaar-Bootstrap": secret },
            });

            const receipt = decodeB64Json(
                (res.headers["payment-response"] as string | undefined) ?? ""
            ) as PaymentReceipt | null;
            // CDP acknowledges discovery metadata on the settle response; the
            // status is success | processing | rejected.
            const extRaw = res.headers["extension-responses"] as string | undefined;
            const bazaar = extRaw
                ? JSON.stringify(decodeB64Json(extRaw) ?? extRaw).slice(0, 200)
                : undefined;

            return { ok: true, tx: receipt?.transaction, bazaar };
        } catch (err) {
            const retryable = isRetryableSettleError(err);
            const detail = err instanceof AxiosError
                ? `HTTP ${String(err.response?.status ?? 0)} ${JSON.stringify(err.response?.data ?? {}).slice(0, 200)}`
                : err instanceof Error ? err.message : String(err);

            if (attempt < retries && retryable) {
                const backoff = 2000 * attempt;
                console.log(`      attempt ${String(attempt)} failed (retryable), waiting ${String(backoff)}ms: ${detail.slice(0, 120)}`);
                await new Promise((r) => setTimeout(r, backoff));
                continue;
            }
            return { ok: false, detail };
        }
    }
    return { ok: false, detail: "retries exhausted" };
}

/** Ask CDP whether the resource is now in the catalog. */
async function cdpIndexState(resource: string): Promise<string> {
    try {
        const res = await axios.post<{ index?: unknown; valid?: boolean }>(
            CDP_VALIDATE,
            { resource, method: "POST" },
            { timeout: 60000 }
        );
        const idx = res.data.index;
        return idx === null || idx === undefined ? "not indexed" : JSON.stringify(idx).slice(0, 120);
    } catch (err) {
        return `validate failed: ${err instanceof Error ? err.message : String(err)}`;
    }
}

async function run(): Promise<void> {
    const rawPrivateKey = process.env.PRIVATE_KEY;
    const secret = process.env.BAZAAR_BOOTSTRAP_SECRET;
    if (!rawPrivateKey) {
        throw new Error(
            "Set PRIVATE_KEY to the Base mainnet wallet key funded with USDC.\n" +
            "  PowerShell: $env:PRIVATE_KEY='0x...' ; pnpm run bootstrap-payment"
        );
    }
    if (!secret) {
        throw new Error(
            "Set BAZAAR_BOOTSTRAP_SECRET to the value deployed as the Worker secret.\n" +
            "Without it the payment settles through PayAI and CDP will not index anything.\n" +
            "  wrangler secret put BAZAAR_BOOTSTRAP_SECRET"
        );
    }

    const apiUrl = process.env.API_URL ?? "https://api.weblens.dev";
    const confirmed = process.env.CONFIRM === "yes";
    const retries = Number(process.env.RETRIES ?? 4);
    const maxPrice = Math.round(Number(process.env.MAX_PRICE ?? 0.02) * 1e6);
    const maxTotal = Math.round(Number(process.env.MAX_TOTAL ?? 1) * 1e6);
    const explicit = process.env.ENDPOINTS?.split(",").map((s) => s.trim()).filter(Boolean);
    const account = privateKeyToAccount(rawPrivateKey as Hex);

    const candidates = (explicit ?? PAID_ENDPOINTS).filter((p) => !NEVER_SEED.has(p));

    console.log("━".repeat(64));
    console.log("🌱 WebLens → CDP Bazaar seeding");
    console.log("━".repeat(64));
    console.log(`  API:        ${apiUrl}`);
    console.log(`  Wallet:     ${account.address}`);
    console.log(`  Mode:       ${confirmed ? "PAY (CONFIRM=yes)" : "PLAN ONLY — set CONFIRM=yes to pay"}`);
    console.log(`  Candidates: ${String(candidates.length)}${explicit ? " (explicit)" : ` at or below ${usd(maxPrice)}`}`);
    console.log("━".repeat(64));

    console.log("\n📋 Probing 402 challenges for price and a valid body...");
    const plans: Plan[] = [];
    for (const path of candidates) {
        const plan = await probe(apiUrl, path);
        if (!plan) {continue;}
        if (!explicit && plan.amount > maxPrice) {
            console.log(`   ${path}: ${usd(plan.amount)} exceeds MAX_PRICE — skipping`);
            continue;
        }
        plans.push(plan);
    }

    const total = plans.reduce((s, p) => s + p.amount, 0);
    console.log(`\n📊 Plan: ${String(plans.length)} endpoint(s), total ${usd(total)}`);
    for (const p of plans) {
        console.log(`   ${p.path.padEnd(30)} ${usd(p.amount)}`);
    }

    if (plans.length === 0) {
        console.log("\nNothing to seed.");
        return;
    }
    if (total > maxTotal) {
        throw new Error(
            `Plan total ${usd(total)} exceeds MAX_TOTAL ${usd(maxTotal)}. ` +
            `Raise MAX_TOTAL or lower MAX_PRICE.`
        );
    }
    if (!confirmed) {
        console.log("\n⏸  Plan only — no payment made. Re-run with CONFIRM=yes to seed.");
        return;
    }

    console.log("\n💸 Seeding (each payment settles through CDP)...");
    const results: { path: string; ok: boolean; tx?: string; bazaar?: string; detail?: string }[] = [];
    let spent = 0;
    for (const plan of plans) {
        console.log(`\n   → ${plan.path} (${usd(plan.amount)})`);
        const r = await seed(apiUrl, plan, secret, account, retries);
        results.push({ path: plan.path, ...r });
        if (r.ok) {
            spent += plan.amount;
            console.log(`      ✅ settled${r.tx ? ` tx=${r.tx}` : ""}`);
            if (r.tx) {console.log(`         https://basescan.org/tx/${r.tx}`);}
            console.log(`      bazaar ack: ${r.bazaar ?? "no EXTENSION-RESPONSES header"}`);
        } else {
            console.log(`      ❌ ${r.detail ?? "failed"}`);
        }
    }

    const ok = results.filter((r) => r.ok);
    console.log("\n" + "━".repeat(64));
    console.log(`  settled ${String(ok.length)}/${String(results.length)}, spent ${usd(spent)}`);
    console.log("━".repeat(64));

    if (ok.length > 0) {
        console.log("\n🔎 CDP index state (indexing is not instant; re-check in a few minutes):");
        for (const r of ok) {
            console.log(`   ${r.path.padEnd(30)} ${await cdpIndexState(`${apiUrl}${r.path}`)}`);
        }
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
        console.log(`\n⚠️  ${String(failed.length)} endpoint(s) did not settle — safe to re-run, seeding is idempotent per resource.`);
        process.exitCode = 1;
    }
}

run()
    .then(() => { console.log("\n🎉 Done."); })
    .catch((e: unknown) => {
        console.error(e instanceof Error ? e.message : String(e));
        process.exitCode = 1;
    });
