/**
 * Canary payments: settle real x402 payments against the live API, on a
 * chosen network, through a chosen facilitator path, and report what happened.
 *
 * Three jobs, one tool:
 *   1. Prove a payment path works end-to-end. A settle path nobody has
 *      exercised (Solana, until this script) fails silently from the outside:
 *      buyers get an error and leave, which looks exactly like no demand.
 *   2. Measure facilitator reliability (settled / attempted per facilitator),
 *      which decides the facilitator order in production.
 *   3. Seed catalog listings. A catalog record is written by whichever
 *      facilitator settles the payment, and the CDP Bazaar indexes a route only
 *      after the CDP facilitator itself settles a payment for it
 *      (https://docs.cdp.coinbase.com/x402/seller/get-discovered).
 *
 * Paths (FACILITATOR):
 *   normal   (default) the request takes the production path — whatever
 *            facilitator the Worker prefers for that network.
 *   cdp      sends `X-Bazaar-Bootstrap: $BAZAAR_BOOTSTRAP_SECRET`, which makes
 *            that one request CDP-primary (see wantsCdpBootstrap); other
 *            buyers' traffic is unaffected.
 *
 * Networks (PAY_NETWORK):
 *   base     EVM_PRIVATE_KEY = 64-hex-character key (0x prefix optional; Phantom
 *            shows one key for all its EVM networks) of a wallet holding USDC on
 *            Base. No ETH needed: EIP-3009 transferWithAuthorization is
 *            submitted (and paid for) by the facilitator.
 *   solana   SVM_PRIVATE_KEY = base58 64-byte secret key (Phantom's "Export
 *            Private Key" format) of a wallet holding USDC on Solana. No SOL
 *            needed: the facilitator's sponsored fee payer pays the fee.
 *
 * Use a dedicated burner wallet, never a payout wallet (self-payments are
 * rejected), and pass its address to `pnpm run funnel` as EXCLUDE_PAYERS so
 * canary payments never count as revenue.
 *
 * Safety: this spends real USDC, so it PLANS by default and pays only with
 * CONFIRM=yes. Prices come from each endpoint's own live 402 challenge (never
 * hardcoded); MAX_PRICE and MAX_TOTAL cap the spend.
 *
 * Usage (PowerShell):
 *   $env:PAY_NETWORK='solana'; $env:SVM_PRIVATE_KEY='…'; $env:ENDPOINTS='/fetch/basic'; pnpm run canary
 *   $env:CONFIRM='yes'; pnpm run canary
 *
 * Options:
 *   PAY_NETWORK=base|solana   network to pay on (required)
 *   FACILITATOR=normal|cdp    facilitator path (default normal)
 *   ENDPOINTS=/a,/b           pay exactly these paths, ignoring MAX_PRICE
 *   MAX_PRICE=0.02            skip endpoints dearer than this, in USDC
 *   MAX_TOTAL=0.10            abort if the plan exceeds this total, in USDC
 *   API_URL=…                 target (default https://api.weblens.dev)
 *   RETRIES=2                 attempts per endpoint on a retryable settle failure
 */

import { createKeyPairSignerFromBytes, getBase58Encoder } from "@solana/kit";
import { x402Client, wrapAxiosWithPayment } from "@x402/axios";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import axios, { AxiosError } from "axios";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Buffer } from "node:buffer";
import process from "node:process";
import { NETWORKS } from "../src/config";
import { endpointForPath, EVM_ONLY_PAID_PATHS, PAID_ENDPOINTS } from "../src/endpoints";

const CDP_VALIDATE = "https://api.cdp.coinbase.com/platform/v2/x402/validate";

type PayNetwork = "base" | "solana";
type FacilitatorPath = "normal" | "cdp";

/** Mainnet CAIP-2 id each PAY_NETWORK pays on. */
const CAIP2: Record<PayNetwork, string> = {
    base: NETWORKS.baseMainnet,
    solana: NETWORKS.solanaMainnet,
};

const EXPLORER_TX: Record<PayNetwork, string> = {
    base: "https://basescan.org/tx/",
    solana: "https://solscan.io/tx/",
};

/** One `accepts` entry of an x402 v2 challenge, narrowed to what is used here. */
interface ChallengeAccept {
    amount?: string;
    network?: string;
    payTo?: string;
}

interface Challenge {
    accepts?: ChallengeAccept[];
    extensions?: {
        bazaar?: { info?: { input?: { body?: Record<string, unknown> } } };
    };
}

interface PaymentReceipt {
    success?: boolean;
    transaction?: string;
    network?: string;
    payer?: string;
}

interface Plan {
    path: string;
    /** Atomic USDC units (6 decimals) for the chosen network. */
    amount: number;
    /** Request body taken from the endpoint's own bazaar input example. */
    body: Record<string, unknown>;
    payTo: string;
}

interface Payer {
    address: string;
    register(client: x402Client): void;
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
 * Resolve one `ENDPOINTS` entry to a known paid path. Git Bash (MSYS) rewrites
 * env values that look like Unix paths (`/fetch/basic` arrives as
 * `C:/Program Files/Git/fetch/basic`), so recover by matching the tail, and
 * reject anything that is not a paid endpoint so typos fail here.
 */
function resolveEndpoint(raw: string): string {
    if (PAID_ENDPOINTS.includes(raw)) { return raw; }
    const recovered = PAID_ENDPOINTS.find((p) => raw.endsWith(p));
    if (recovered) {
        console.log(`   note: "${raw}" → ${recovered} (shell rewrote the leading slash; in Git Bash use MSYS_NO_PATHCONV=1)`);
        return recovered;
    }
    throw new Error(`ENDPOINTS contains "${raw}", which is not a paid endpoint.\nValid values: ${PAID_ENDPOINTS.join(", ")}`);
}

function required(name: string): string {
    const value = process.env[name];
    if (!value) { throw new Error(`${name} is not set`); }
    return value;
}

function parseNetwork(): PayNetwork {
    const value = required("PAY_NETWORK");
    if (value !== "base" && value !== "solana") {
        throw new Error(`PAY_NETWORK must be "base" or "solana", got "${value}"`);
    }
    return value;
}

function parseFacilitator(): FacilitatorPath {
    const value = process.env.FACILITATOR ?? "normal";
    if (value !== "normal" && value !== "cdp") {
        throw new Error(`FACILITATOR must be "normal" or "cdp", got "${value}"`);
    }
    return value;
}

/** A 32-byte hex private key. Wallet exports differ on the 0x prefix, so either form is accepted. */
function evmPrivateKey(): Hex {
    const raw = required("EVM_PRIVATE_KEY").trim();
    const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
    if (!/^[0-9a-fA-F]{64}$/u.test(hex)) {
        throw new Error("EVM_PRIVATE_KEY must be 64 hex characters (32 bytes), with or without a 0x prefix");
    }
    return `0x${hex}`;
}

/** The 64-byte Solana secret key, from the base58 string Phantom exports. */
function svmSecretKey(): Uint8Array {
    const secret = getBase58Encoder().encode(required("SVM_PRIVATE_KEY").trim());
    if (secret.length !== 64) {
        throw new Error(`SVM_PRIVATE_KEY must decode to a 64-byte secret key (got ${String(secret.length)} bytes): paste the Solana private key exactly as Phantom shows it`);
    }
    return new Uint8Array(secret);
}

/** Build the payer for the chosen network from its key; only that scheme is registered. */
async function loadPayer(network: PayNetwork): Promise<Payer> {
    if (network === "base") {
        const account = privateKeyToAccount(evmPrivateKey());
        return { address: account.address, register: (client) => { registerExactEvmScheme(client, { signer: account }); } };
    }
    const signer = await createKeyPairSignerFromBytes(svmSecretKey());
    return { address: signer.address, register: (client) => { registerExactSvmScheme(client, { signer }); } };
}

/** POST `body` unpaid and return the endpoint's 402 challenge, or null (logged) when there is none. */
async function challengeFor(apiUrl: string, path: string, body: Record<string, unknown>): Promise<Challenge | null> {
    try {
        await axios.post(`${apiUrl}${path}`, body, { timeout: 30000 });
        console.log(`   ${path}: expected 402, got 2xx — skipping`);
        return null;
    } catch (err) {
        if (!(err instanceof AxiosError) || !err.response) { throw err; }
        if (err.response.status !== 402) {
            console.log(`   ${path}: expected 402, got ${String(err.response.status)} — skipping`);
            return null;
        }
        const header = err.response.headers["payment-required"] as string | undefined;
        const challenge = header ? decodeB64Json(header) as Challenge | null : null;
        if (!challenge) { console.log(`   ${path}: 402 without a decodable challenge — skipping`); }
        return challenge;
    }
}

/**
 * Read an endpoint's own 402 challenge for the chosen network: a body
 * guaranteed to validate (the published bazaar example), and the price and
 * payTo for exactly that body.
 */
async function probe(apiUrl: string, path: string, caip2: string): Promise<Plan | null> {
    // An empty body still reaches the 402 (probe-friendly validation), which carries the example.
    const example = (await challengeFor(apiUrl, path, {}))?.extensions?.bazaar?.info?.input?.body;
    if (!example) {
        console.log(`   ${path}: no bazaar input example to build a valid body — skipping`);
        return null;
    }
    // A canary must run the handler and pay the full price. A cache hit skips
    // the handler and charges the discounted price, which CDP rejects below its
    // minimum as `amount_too_low` (a $0.0006 cached /fetch/basic was refused).
    const body = endpointForPath(path)?.cacheKey ? { ...example, cache: false } : example;
    // Price the body that will be paid with: dynamic prices depend on it.
    const accept = (await challengeFor(apiUrl, path, body))?.accepts?.find((a) => a.network === caip2);
    if (!accept?.amount || !accept.payTo) {
        console.log(`   ${path}: challenge does not offer ${caip2} — skipping`);
        return null;
    }
    return { path, amount: Number(accept.amount), body, payTo: accept.payTo };
}

/** True for transient settle failures worth one more attempt (e.g. CDP #1065 gas estimation). */
function isRetryableSettleError(err: unknown): boolean {
    const text = err instanceof AxiosError ? JSON.stringify(err.response?.data ?? err.message) : String(err);
    return /unable to estimate gas|gas required exceeds|settle.*failed|timeout|settlement_pending/iu.test(text);
}

async function pay(
    apiUrl: string,
    plan: Plan,
    payer: Payer,
    bootstrapSecret: string | undefined,
    retries: number,
): Promise<{ ok: boolean; tx?: string; detail?: string; attempts: number }> {
    for (let attempt = 1; attempt <= retries; attempt++) {
        // A fresh client per attempt: a failed settle must not leave state behind.
        const client = new x402Client();
        payer.register(client);
        const http = wrapAxiosWithPayment(axios.create({ baseURL: apiUrl, timeout: 120000 }), client);
        try {
            const res = await http.post(plan.path, plan.body, {
                headers: bootstrapSecret ? { "X-Bazaar-Bootstrap": bootstrapSecret } : {},
            });
            const receipt = decodeB64Json((res.headers["payment-response"] as string | undefined) ?? "") as PaymentReceipt | null;
            return { ok: receipt?.success === true, tx: receipt?.transaction, detail: receipt ? undefined : "no PAYMENT-RESPONSE header", attempts: attempt };
        } catch (err) {
            const detail = err instanceof AxiosError
                ? `HTTP ${String(err.response?.status ?? 0)} ${JSON.stringify(err.response?.data ?? {}).slice(0, 300)}`
                : err instanceof Error ? err.message : String(err);
            if (attempt < retries && isRetryableSettleError(err)) {
                const backoff = 2000 * attempt;
                console.log(`      attempt ${String(attempt)} failed (retryable), waiting ${String(backoff)}ms: ${detail.slice(0, 160)}`);
                await new Promise((r) => setTimeout(r, backoff));
                continue;
            }
            return { ok: false, detail, attempts: attempt };
        }
    }
    return { ok: false, detail: "retries exhausted", attempts: retries };
}

/** Ask CDP whether a resource is in its Bazaar index (public endpoint, no key). */
async function cdpIndexState(resource: string): Promise<string> {
    try {
        const res = await axios.post<{ index?: unknown }>(CDP_VALIDATE, { resource, method: "POST" }, { timeout: 60000 });
        const idx = res.data.index;
        return idx === null || idx === undefined ? "not indexed (yet)" : JSON.stringify(idx).slice(0, 120);
    } catch (err) {
        return `validate failed: ${err instanceof Error ? err.message : String(err)}`;
    }
}

async function run(): Promise<void> {
    const network = parseNetwork();
    const facilitator = parseFacilitator();
    const bootstrapSecret = facilitator === "cdp" ? required("BAZAAR_BOOTSTRAP_SECRET") : undefined;
    const apiUrl = process.env.API_URL ?? "https://api.weblens.dev";
    const confirmed = process.env.CONFIRM === "yes";
    const retries = Number(process.env.RETRIES ?? 2);
    const maxPrice = Math.round(Number(process.env.MAX_PRICE ?? 0.02) * 1e6);
    const maxTotal = Math.round(Number(process.env.MAX_TOTAL ?? 0.10) * 1e6);
    const explicit = process.env.ENDPOINTS?.split(",").map((s) => s.trim()).filter(Boolean).map(resolveEndpoint);
    const caip2 = CAIP2[network];
    const payer = await loadPayer(network);

    // Never self-pay a billing action (credits move money into our own ledger),
    // and EVM-only paths cannot be paid on Solana at all.
    const candidates = (explicit ?? PAID_ENDPOINTS).filter((p) => endpointForPath(p)?.group !== "Credits"
        && !(network === "solana" && EVM_ONLY_PAID_PATHS.includes(p)));

    console.log("━".repeat(64));
    console.log("  WebLens canary payments");
    console.log("━".repeat(64));
    console.log(`  Network:     ${network} (${caip2})`);
    console.log(`  Facilitator: ${facilitator === "cdp" ? "CDP (bootstrap header)" : "normal production path"}`);
    console.log(`  API:         ${apiUrl}`);
    console.log(`  Payer:       ${payer.address}   ← pass to \`pnpm run funnel\` as EXCLUDE_PAYERS`);
    console.log(`  Mode:        ${confirmed ? "PAY (CONFIRM=yes)" : "PLAN ONLY — set CONFIRM=yes to pay"}`);
    console.log("━".repeat(64));

    console.log("\nProbing 402 challenges for price and a valid body...");
    const plans: Plan[] = [];
    for (const path of candidates) {
        const plan = await probe(apiUrl, path, caip2);
        if (!plan) { continue; }
        if (!explicit && plan.amount > maxPrice) {
            console.log(`   ${path}: ${usd(plan.amount)} exceeds MAX_PRICE — skipping`);
            continue;
        }
        plans.push(plan);
    }

    const total = plans.reduce((s, p) => s + p.amount, 0);
    console.log(`\nPlan: ${String(plans.length)} endpoint(s), total ${usd(total)}`);
    for (const p of plans) { console.log(`   ${p.path.padEnd(30)} ${usd(p.amount)}`); }
    if (plans.length === 0) { return; }

    const selfPaid = plans.find((p) => p.payTo.toLowerCase() === payer.address.toLowerCase());
    if (selfPaid) {
        throw new Error(`The payer ${payer.address} is the payTo for ${selfPaid.path}. Pay from a separate burner wallet.`);
    }
    if (total > maxTotal) {
        throw new Error(`Plan total ${usd(total)} exceeds MAX_TOTAL ${usd(maxTotal)}. Raise MAX_TOTAL or lower MAX_PRICE.`);
    }
    if (!confirmed) {
        console.log("\nPlan only — no payment made. Re-run with CONFIRM=yes to pay.");
        return;
    }

    console.log("\nPaying...");
    const results: { path: string; ok: boolean; tx?: string; detail?: string; attempts: number }[] = [];
    for (const plan of plans) {
        console.log(`\n   → ${plan.path} (${usd(plan.amount)})`);
        const r = await pay(apiUrl, plan, payer, bootstrapSecret, retries);
        results.push({ path: plan.path, ...r });
        if (r.ok) {
            console.log(`      settled  ${r.tx ? EXPLORER_TX[network] + r.tx : "(no tx hash returned)"}`);
        } else {
            console.log(`      FAILED   ${r.detail ?? "unknown"}`);
        }
    }

    const ok = results.filter((r) => r.ok);
    const attempts = results.reduce((s, r) => s + r.attempts, 0);
    console.log("\n" + "━".repeat(64));
    console.log(`  settled ${String(ok.length)}/${String(results.length)} endpoint(s) in ${String(attempts)} attempt(s), spent ${usd(ok.reduce((s, r) => s + (plans.find((p) => p.path === r.path)?.amount ?? 0), 0))}`);
    console.log("━".repeat(64));

    if (ok.length > 0 && facilitator === "cdp") {
        console.log("\nCDP index state (indexing is not instant; re-check in a few minutes):");
        for (const r of ok) {
            console.log(`   ${r.path.padEnd(30)} ${await cdpIndexState(`${apiUrl}${r.path}`)}`);
        }
    }
    if (ok.length < results.length) {
        process.exitCode = 1;
    }
}

run().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
});
