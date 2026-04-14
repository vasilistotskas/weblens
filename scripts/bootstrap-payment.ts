/**
 * Bootstrap CDP Bazaar listing with a single real x402 payment.
 *
 * Why this exists: Coinbase's Bazaar (api.cdp.coinbase.com/platform/v2/x402/discovery/resources)
 * only lists services after the facilitator has successfully processed a
 * `verify + settle` cycle for them. Without a first payment, autonomous
 * agents that rely on Bazaar discovery will never find WebLens.
 *
 * This script settles exactly ONE payment to /fetch/basic ($0.005 USDC on
 * Base mainnet) so the CDP facilitator indexes every endpoint sharing our
 * payTo address. After settlement, Bazaar indexing usually completes within
 * 5–10 minutes — run `pnpm run verify-bazaar` to confirm.
 *
 * Usage (PowerShell):
 *   $env:PRIVATE_KEY='0x...' ; pnpm run bootstrap-payment
 *
 * Usage (bash):
 *   PRIVATE_KEY=0x... pnpm run bootstrap-payment
 *
 * Optional:
 *   API_URL=https://api.weblens.dev      Override target (default: production)
 *   ENDPOINT=/fetch/basic                Override payment path (default: cheapest paid route)
 *
 * Prerequisites: the wallet must hold a small USDC balance on Base mainnet
 * (~$0.01 is plenty — exact cost is $0.005 + on-chain gas, ~$0.0001).
 */

import { x402Client, wrapAxiosWithPayment } from "@x402/axios";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import axios, { AxiosError } from "axios";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

interface BootstrapResponse {
    data?: { title?: string; content?: string };
    requestId?: string;
}

interface PaymentReceipt {
    transaction?: string;
    network?: string;
    payer?: string;
}

async function run(): Promise<void> {
    const rawPrivateKey = process.env.PRIVATE_KEY;
    if (!rawPrivateKey) {
        throw new Error(
            "Set PRIVATE_KEY env var to the Base mainnet wallet key funded with USDC.\n" +
            "  PowerShell: $env:PRIVATE_KEY='0x...' ; pnpm run bootstrap-payment"
        );
    }

    const apiUrl = process.env.API_URL ?? "https://api.weblens.dev";
    const endpoint = process.env.ENDPOINT ?? "/fetch/basic";
    const account = privateKeyToAccount(rawPrivateKey as Hex);

    console.log("━".repeat(60));
    console.log("🚀 WebLens Bazaar Bootstrap Payment");
    console.log("━".repeat(60));
    console.log(`  API:       ${apiUrl}`);
    console.log(`  Endpoint:  ${endpoint} ($0.005 USDC)`);
    console.log(`  Wallet:    ${account.address}`);
    console.log(`  Network:   Base mainnet`);
    console.log("━".repeat(60));
    console.log();

    const x402 = new x402Client();
    registerExactEvmScheme(x402, { signer: account });
    const paidClient = wrapAxiosWithPayment(
        axios.create({ baseURL: apiUrl, timeout: 60000 }),
        x402
    );

    console.log(`📡 POST ${endpoint} (expecting 402 → sign → settle → 200)...`);
    const started = Date.now();

    let response;
    try {
        response = await paidClient.post<BootstrapResponse>(endpoint, {
            url: "https://example.com",
        });
    } catch (err) {
        if (err instanceof AxiosError && err.response) {
            console.error(`❌ Payment failed: HTTP ${String(err.response.status)}`);
            console.error("   Response:", JSON.stringify(err.response.data).slice(0, 400));
            console.error("   Hint: verify the wallet has USDC on Base mainnet and ETH for gas.");
            process.exitCode = 1;
            return;
        }
        throw err;
    }

    const elapsedMs = Date.now() - started;
    console.log(`✅ HTTP ${String(response.status)} (${String(elapsedMs)}ms)`);

    const receiptHeader = response.headers["payment-response"] as string | undefined;
    if (receiptHeader) {
        try {
            const decoded = JSON.parse(
                Buffer.from(receiptHeader, "base64").toString()
            ) as PaymentReceipt;
            console.log();
            console.log("💰 Settlement receipt:");
            console.log(`   tx:      ${decoded.transaction ?? "?"}`);
            console.log(`   network: ${decoded.network ?? "?"}`);
            console.log(`   payer:   ${decoded.payer ?? "?"}`);
            if (decoded.transaction) {
                console.log(`   explorer: https://basescan.org/tx/${decoded.transaction}`);
            }
        } catch {
            console.log("⚠️  Receipt header present but could not be decoded.");
        }
    } else {
        console.log("⚠️  No PAYMENT-RESPONSE header — settlement may have been skipped.");
    }

    const title = response.data.data?.title;
    if (title) {
        console.log(`\n📄 Response title: ${title}`);
    }

    console.log();
    console.log("━".repeat(60));
    console.log("🎯 Next steps");
    console.log("━".repeat(60));
    console.log("  1. Wait 5–10 minutes for the CDP facilitator to index the resource.");
    console.log("  2. Verify Bazaar listing: pnpm run verify-bazaar");
    console.log("  3. Once listed, all endpoints sharing the same payTo are discoverable.");
    console.log();
}

run()
    .then(() => { console.log("🎉 Bootstrap complete."); })
    .catch((e: unknown) => {
        console.error(e instanceof Error ? e.message : String(e));
        process.exitCode = 1;
    });
