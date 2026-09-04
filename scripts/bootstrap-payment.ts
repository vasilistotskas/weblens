/**
 * Write catalog listings by settling one real x402 payment per resource.
 *
 * Two catalogs, two facilitators, and the choice matters — a catalog record is
 * written by **whichever facilitator settles the payment**, so seeding one does
 * nothing for the other. Pick with `FACILITATOR`:
 *
 *   FACILITATOR=cdp    (default) settle through CDP → CDP Bazaar listings.
 *   FACILITATOR=payai            settle through PayAI → refresh PayAI records.
 *
 * PayAI mode exists because WebLens' PayAI records went stale. Nine of the
 * fourteen were last written by the 2025-11-30 self-tests and still carry
 * `x402Version: 1`, `network: "base"`, an empty top-level input/output schema
 * and description, prices from before the 2026-08 repricing, and a payTo that
 * is no longer the payout address. Only a fresh PayAI settlement rewrites them.
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
 *   FACILITATOR=payai   Which facilitator settles, and so which catalog gets
 *                       the record: cdp (default) or payai
 *   MAX_PRICE=0.02      Skip endpoints dearer than this, in USDC (default 0.02)
 *   MAX_TOTAL=1.00      Abort if the plan exceeds this total (default 1.00)
 *   ENDPOINTS=/a,/b     Seed exactly these paths, ignoring MAX_PRICE
 *   API_URL=...         Target (default https://api.weblens.dev)
 *   RETRIES=4           Attempts per endpoint; #1065 fails intermittently
 *
 * Prerequisites:
 *   - BAZAAR_BOOTSTRAP_SECRET must match the deployed Worker secret — CDP mode
 *     only. PayAI is already the default facilitator, so PayAI mode sends no
 *     bootstrap header and needs no secret.
 *   - The wallet needs **USDC only** — no ETH. x402 settles via EIP-3009
 *     `transferWithAuthorization`: the payer signs off-chain and the
 *     facilitator submits the transaction and pays gas. Verified against the
 *     two real buyers of this API, who both hold 0 ETH and have sent 0
 *     transactions, yet paid successfully.
 *   - The wallet must NOT be PAY_TO_ADDRESS: CDP rejects self-payments.
 */

import { x402Client, wrapAxiosWithPayment } from "@x402/axios";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import axios, { AxiosError } from "axios";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Buffer } from "node:buffer";
import { PAID_ENDPOINTS } from "../src/config";

const CDP_VALIDATE = "https://api.cdp.coinbase.com/platform/v2/x402/validate";
const PAYAI_DISCOVERY = "https://facilitator.payai.network/discovery/resources";

/** Which facilitator settles, and therefore which catalog records the resource. */
type Facilitator = "cdp" | "payai";

/** One row of the PayAI discovery catalog, narrowed to the fields compared here. */
interface CatalogRecord {
    resource?: string;
    x402Version?: number;
    lastUpdated?: string;
    inputSchema?: unknown;
    accepts?: (ChallengeAccept & { maxAmountRequired?: string })[];
}

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

interface ChallengeAccept extends Accept {
    payTo?: string;
}

interface Challenge {
    accepts?: ChallengeAccept[];
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
    /** Recipient advertised by the challenge, used for the self-payment guard. */
    payTo?: string;
}

const usd = (atomic: number): string => `$${(atomic / 1e6).toFixed(4)}`;

/**
 * Resolve one `ENDPOINTS` entry to a known paid path.
 *
 * Git Bash (MSYS) rewrites env values that look like Unix paths before Node
 * sees them — `ENDPOINTS=/fetch/basic` arrives as
 * `C:/Program Files/Git/fetch/basic` — which otherwise fails much later as a
 * DNS error on a mangled URL. Recover by matching the tail, and reject
 * anything that is not a real paid endpoint so typos fail loudly here.
 */
function resolveEndpoint(raw: string): string {
    if (PAID_ENDPOINTS.includes(raw)) {return raw;}

    const recovered = PAID_ENDPOINTS.find((p) => raw.endsWith(p));
    if (recovered) {
        console.log(`   note: "${raw}" → ${recovered} (shell rewrote the leading slash; in Git Bash use MSYS_NO_PATHCONV=1)`);
        return recovered;
    }
    throw new Error(
        `ENDPOINTS contains "${raw}", which is not a paid endpoint.\n` +
        `Valid values: ${PAID_ENDPOINTS.join(", ")}`
    );
}

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
        return { path, amount, body, payTo: challenge.accepts?.[0]?.payTo };
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
    /** CDP mode only. Undefined in PayAI mode, which sends no bootstrap header. */
    secret: string | undefined,
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
            // With no secret the request takes the normal path, which is
            // PayAI-primary — exactly what refreshing a PayAI record needs.
            const res = await client.post(plan.path, plan.body, {
                headers: secret ? { "X-Bazaar-Bootstrap": secret } : {},
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

/**
 * Every WebLens record in the PayAI catalog, keyed by resource URL.
 *
 * The discovery API accepts no resource/search filter — resource=, search=, q=
 * and payTo= all return the same unfiltered set (~28k rows and growing), so the
 * only way to read one record is to page the whole catalog and pick it out.
 */
async function payaiRecords(apiUrl: string): Promise<Map<string, CatalogRecord>> {
    const found = new Map<string, CatalogRecord>();
    for (let offset = 0; offset < 60000; offset += 1000) {
        const res = await axios.get<{ items?: CatalogRecord[] }>(
            PAYAI_DISCOVERY,
            { params: { limit: 1000, offset }, timeout: 60000 }
        );

        const items = res.data.items ?? [];
        for (const item of items) {
            const resource = item.resource ?? "";
            if (resource.startsWith(apiUrl)) {found.set(resource, item);}
        }
        if (items.length < 1000) {break;}
    }
    return found;
}

/** One-line summary of a catalog record, for before/after comparison. */
function describeRecord(record: CatalogRecord | undefined): string {
    if (!record) {return "not listed";}

    const accepts = record.accepts?.[0] ?? {};
    // v1 records store the price as maxAmountRequired; v2 renamed it to amount.
    const price = accepts.amount ?? accepts.maxAmountRequired;
    const schemaBytes = JSON.stringify(record.inputSchema ?? null).length;

    return [
        `v${String(record.x402Version ?? "?")}`,
        accepts.network ?? "?",
        price === undefined ? "no price" : usd(Number(price)),
        `payTo=${(accepts.payTo ?? "?").slice(0, 10)}`,
        `inputSchema=${String(schemaBytes)}B`,
        record.lastUpdated ?? "?",
    ].join("  ");
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
    const facilitator: Facilitator = process.env.FACILITATOR === "payai" ? "payai" : "cdp";
    if (facilitator === "cdp" && !secret) {
        throw new Error(
            "Set BAZAAR_BOOTSTRAP_SECRET to the value deployed as the Worker secret.\n" +
            "Without it the payment settles through PayAI and CDP will not index anything.\n" +
            "  wrangler secret put BAZAAR_BOOTSTRAP_SECRET\n" +
            "To refresh the PayAI catalog instead, run with FACILITATOR=payai (no secret needed)."
        );
    }
    // PayAI is already primary on the normal path, so the header must be absent
    // for the settlement to reach it — never send one in PayAI mode.
    const bootstrapSecret = facilitator === "cdp" ? secret : undefined;

    const apiUrl = process.env.API_URL ?? "https://api.weblens.dev";
    const confirmed = process.env.CONFIRM === "yes";
    const retries = Number(process.env.RETRIES ?? 4);
    const maxPrice = Math.round(Number(process.env.MAX_PRICE ?? 0.02) * 1e6);
    const maxTotal = Math.round(Number(process.env.MAX_TOTAL ?? 1) * 1e6);
    const explicit = process.env.ENDPOINTS
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(resolveEndpoint);
    const account = privateKeyToAccount(rawPrivateKey as Hex);

    const candidates = (explicit ?? PAID_ENDPOINTS).filter((p) => !NEVER_SEED.has(p));

    console.log("━".repeat(64));
    console.log(
        facilitator === "cdp"
            ? "🌱 WebLens → CDP Bazaar seeding"
            : "♻️  WebLens → PayAI catalog refresh"
    );
    console.log("━".repeat(64));
    console.log("  Settles by: " + facilitator);
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

    // CDP rejects self-payments outright, and an EIP-3009 authorization from the
    // payTo wallet to itself is not worth debugging on either facilitator.
    // Catch it once here instead of after N confusing settles.
    const selfPaid = plans.find(
        (p) => p.payTo?.toLowerCase() === account.address.toLowerCase()
    );
    if (selfPaid) {
        throw new Error(
            `PRIVATE_KEY belongs to ${account.address}, which is the payTo address for ` +
            `${selfPaid.path}. Pay from a different wallet funded with USDC on Base ` +
            `mainnet (CDP rejects self-payments outright).`
        );
    }
    if (total > maxTotal) {
        throw new Error(
            `Plan total ${usd(total)} exceeds MAX_TOTAL ${usd(maxTotal)}. ` +
            `Raise MAX_TOTAL or lower MAX_PRICE.`
        );
    }
    if (facilitator === "payai") {
        console.log("\n🔎 Current PayAI records (paging the unfiltered catalog, ~30 requests)...");
        const before = await payaiRecords(apiUrl);
        for (const p of plans) {
            console.log("   " + p.path.padEnd(24) + " " + describeRecord(before.get(apiUrl + p.path)));
        }
    }

    if (!confirmed) {
        console.log("\n⏸  Plan only — no payment made. Re-run with CONFIRM=yes to seed.");
        return;
    }

    console.log("\n💸 Paying (each payment settles through " + facilitator + ")...");
    const results: { path: string; ok: boolean; tx?: string; bazaar?: string; detail?: string }[] = [];
    let spent = 0;
    for (const plan of plans) {
        console.log(`\n   → ${plan.path} (${usd(plan.amount)})`);
        const r = await seed(apiUrl, plan, bootstrapSecret, account, retries);
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

    if (ok.length > 0 && facilitator === "payai") {
        console.log("\n🔎 PayAI records now (indexing is not instant; re-check in a few minutes):");
        const after = await payaiRecords(apiUrl);
        for (const r of ok) {
            console.log("   " + r.path.padEnd(24) + " " + describeRecord(after.get(apiUrl + r.path)));
        }
    }

    if (ok.length > 0 && facilitator === "cdp") {
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
