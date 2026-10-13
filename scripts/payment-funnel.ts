/**
 * Payment funnel report from the PAYMENT_EVENTS Analytics Engine dataset
 * (written by src/services/payment-telemetry.ts, one event per paid-route
 * request; the dataset is adaptively sampled).
 *
 * Usage:
 *   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… pnpm run funnel
 *
 * Env:
 *   CLOUDFLARE_ACCOUNT_ID  account that owns the Worker
 *   CLOUDFLARE_API_TOKEN   token with "Account Analytics: Read" only
 *   DAYS                   lookback window (default 7)
 *   DATASET_ENV            "production" (default) or "testnet" — which PAYMENT_EVENTS_DATASETS entry to read
 *   EXCLUDE_PAYERS         comma-separated payer addresses to leave out (the canary payer)
 *
 * Counts use SUM(_sample_interval), as the Analytics Engine SQL API requires.
 * Sampling happens even at our volume (2026-10-13: 8 stored settle rows carried a
 * total weight of 14), so the totals are estimates; count revenue on-chain.
 */

import process from "node:process";
import { PAYMENT_EVENTS_DATASETS } from "../src/config";
import { PAYMENT_EVENT_BLOBS, PAYMENT_EVENT_DOUBLES } from "../src/services/payment-telemetry";
import type { PaymentOutcome } from "../src/services/payment-telemetry";

type Blob = (typeof PAYMENT_EVENT_BLOBS)[number];
type Double = (typeof PAYMENT_EVENT_DOUBLES)[number];
const blob = (name: Blob): string => `blob${String(PAYMENT_EVENT_BLOBS.indexOf(name) + 1)}`;
const double = (name: Double): string => `double${String(PAYMENT_EVENT_DOUBLES.indexOf(name) + 1)}`;

/** Outcomes that mean a buyer tried to pay and did not. */
const FAILED_ATTEMPTS: readonly PaymentOutcome[] = [
    "v1_header", "rejected", "verify_rejected", "verify_error", "settle_failed", "canceled",
];

function required(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is not set`);
    }
    return value;
}

function datasetName(): string {
    const env = process.env.DATASET_ENV ?? "production";
    if (env !== "production" && env !== "testnet") {
        throw new Error(`DATASET_ENV must be "production" or "testnet", got "${env}"`);
    }
    return PAYMENT_EVENTS_DATASETS[env];
}

interface SqlResult<Row> { data: Row[] }

async function query<Row>(accountId: string, token: string, sql: string): Promise<Row[]> {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: sql,
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`Analytics Engine SQL API ${String(res.status)}: ${text.slice(0, 500)}`);
    }
    return (JSON.parse(text) as SqlResult<Row>).data;
}

interface GroupRow {
    route: string;
    outcome: PaymentOutcome;
    network: string;
    facilitator: string;
    reason: string;
    payer: string;
    /** UInt64 aggregate: may arrive as a JSON string. */
    events: number | string;
}

interface SettleRow {
    facilitator: string;
    outcome: PaymentOutcome;
    fallback: string;
    /** UInt64 aggregate: may arrive as a JSON string. */
    events: number | string;
}

interface SettledRow {
    time: string;
    route: string;
    network: string;
    facilitator: string;
    payer: string;
    transaction: string;
    amount: number | string;
}

async function main(): Promise<void> {
    const accountId = required("CLOUDFLARE_ACCOUNT_ID");
    const token = required("CLOUDFLARE_API_TOKEN");
    const days = Number(process.env.DAYS ?? 7);
    if (!Number.isInteger(days) || days < 1) {
        throw new Error("DAYS must be a positive integer");
    }
    const excluded = new Set((process.env.EXCLUDE_PAYERS ?? "").split(",").map((p) => p.trim().toLowerCase()).filter(Boolean));
    const dataset = datasetName();
    const window = `timestamp > NOW() - INTERVAL '${String(days)}' DAY`;

    const groups = (await query<GroupRow>(accountId, token, `
        SELECT index1 AS route, ${blob("outcome")} AS outcome, ${blob("network")} AS network,
               ${blob("facilitator")} AS facilitator, ${blob("reason")} AS reason, ${blob("payer")} AS payer,
               SUM(_sample_interval) AS events
        FROM ${dataset}
        WHERE ${window}
        GROUP BY route, outcome, network, facilitator, reason, payer
        FORMAT JSON`)).filter((r) => !excluded.has(r.payer.toLowerCase()));

    console.log(`\nPayment funnel — dataset ${dataset}, last ${String(days)} day(s)${excluded.size ? `, excluding ${String(excluded.size)} payer(s)` : ""}\n`);

    const byOutcome = new Map<string, number>();
    for (const g of groups) {
        byOutcome.set(g.outcome, (byOutcome.get(g.outcome) ?? 0) + Number(g.events));
    }
    console.log("Outcomes:");
    console.table(Object.fromEntries([...byOutcome].sort((a, b) => b[1] - a[1])));

    const routes = new Map<string, { unpaid: number; attempts: number; settled: number; failed: number }>();
    for (const g of groups) {
        const r = routes.get(g.route) ?? { unpaid: 0, attempts: 0, settled: 0, failed: 0 };
        const n = Number(g.events);
        if (g.outcome === "unpaid") { r.unpaid += n; }
        if (g.outcome === "settled") { r.settled += n; r.attempts += n; }
        if (FAILED_ATTEMPTS.includes(g.outcome)) { r.failed += n; r.attempts += n; }
        routes.set(g.route, r);
    }
    console.log("By route (attempts = settled + failed payment attempts):");
    console.table(Object.fromEntries([...routes].sort((a, b) => b[1].attempts - a[1].attempts || b[1].unpaid - a[1].unpaid)));

    const failures = groups.filter((g) => FAILED_ATTEMPTS.includes(g.outcome));
    if (failures.length > 0) {
        console.log("Failed payment attempts (why buyers did not get through):");
        console.table(failures.map(({ route, outcome, network, facilitator, reason, events }) => ({ route, outcome, network, facilitator, reason, events })));
    }

    const payerCounts = new Map<string, number>();
    for (const g of groups.filter((x) => x.outcome === "settled")) {
        payerCounts.set(g.payer, (payerCounts.get(g.payer) ?? 0) + Number(g.events));
    }
    console.log(`Distinct payers: ${String(payerCounts.size)}, repeat payers: ${String([...payerCounts.values()].filter((n) => n > 1).length)}`);

    // Facilitator reliability. A settle one facilitator failed and the next in
    // its chain took over is recorded in `fallback`, while `facilitator` names
    // only the one that finished: without counting fallbacks, a sale PayAI
    // rescued would read as a plain PayAI sale. All payers count here (the
    // canary too): this measures the facilitator, not revenue.
    const settleRows = await query<SettleRow>(accountId, token, `
        SELECT ${blob("facilitator")} AS facilitator, ${blob("outcome")} AS outcome, ${blob("fallback")} AS fallback,
               SUM(_sample_interval) AS events
        FROM ${dataset}
        WHERE ${window} AND (${blob("fallback")} != '' OR ${blob("outcome")} IN ('settled', 'settle_failed'))
        GROUP BY facilitator, outcome, fallback
        FORMAT JSON`);
    const reliability = new Map<string, { settled: number; handedOver: number; failed: number }>();
    const entry = (facilitator: string) => {
        const current = reliability.get(facilitator) ?? { settled: 0, handedOver: 0, failed: 0 };
        reliability.set(facilitator, current);
        return current;
    };
    const fallbackCounts = new Map<string, number>();
    for (const row of settleRows) {
        const n = Number(row.events);
        if (row.outcome === "settled") { entry(row.facilitator).settled += n; }
        if (row.outcome === "settle_failed") { entry(row.facilitator).failed += n; }
        for (const fallback of row.fallback.split("; ").filter(Boolean)) {
            fallbackCounts.set(fallback, (fallbackCounts.get(fallback) ?? 0) + n);
            const [facilitator = "", operation = ""] = fallback.split(/[ :]/u);
            if (operation === "settle") { entry(facilitator).handedOver += n; }
        }
    }
    if (reliability.size > 0) {
        console.log("Settle reliability per facilitator (handedOver = failed settles the next facilitator took over; all payers):");
        console.table(Object.fromEntries([...reliability].map(([facilitator, r]) => {
            const tried = r.settled + r.handedOver + r.failed;
            return [facilitator, { ...r, successRate: tried > 0 ? `${(100 * r.settled / tried).toFixed(1)}%` : "-" }];
        })));
    }
    if (fallbackCounts.size > 0) {
        console.log("Facilitator fallbacks (failures another facilitator absorbed):");
        console.table(Object.fromEntries([...fallbackCounts].sort((a, b) => b[1] - a[1])));
    }

    const settled = (await query<SettledRow>(accountId, token, `
        SELECT timestamp AS time, index1 AS route, ${blob("network")} AS network, ${blob("facilitator")} AS facilitator,
               ${blob("payer")} AS payer, ${blob("transaction")} AS transaction, ${double("amount")} AS amount
        FROM ${dataset}
        WHERE ${window} AND ${blob("outcome")} = 'settled'
        ORDER BY time DESC
        LIMIT 100
        FORMAT JSON`)).filter((r) => !excluded.has(r.payer.toLowerCase()));
    if (settled.length > 0) {
        console.log("Recent settled payments (amount in atomic USDC units):");
        console.table(settled);
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
