/**
 * Test script for x402 payments using Base Sepolia TESTNET
 *
 * Prerequisites:
 * 1. Get testnet USDC from faucet: https://faucet.circle.com/ (select Base Sepolia)
 * 2. Get testnet ETH from: https://www.alchemy.com/faucets/base-sepolia
 * 3. Start local dev server with testnet config:
 *    wrangler dev --env testnet
 * 4. Run this script:
 *    $env:PRIVATE_KEY='0x...' ; npx tsx scripts/test-payment-testnet.ts
 */

import { x402Client, wrapAxiosWithPayment } from "@x402/axios";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import axios from "axios";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ITestEndpoint {
    name: string;
    method: "GET" | "POST" | "DELETE";
    path: string;
    body?: Record<string, unknown>;
    price: string;
}

interface IWebLensResponseData {
    title?: string;
    content?: string;
    stored?: boolean;
    balance?: number;
    tier?: string;
    results?: unknown[];
    data?: unknown;
    monitorId?: string;
    key?: string;
    keys?: string[];
    [key: string]: unknown;
}

interface IDiscoveryService {
    endpoint: string;
    method: "GET" | "POST" | "DELETE";
    name: string;
    description: string;
    price: string;
}

interface IDiscoveryResponse {
    services: IDiscoveryService[];
}

// Comprehensive mapping of endpoints to test payloads
const TEST_PAYLOADS: Record<string, Record<string, unknown>> = {
    "/fetch/basic": { url: "https://example.com" },
    "/fetch/pro": { url: "https://example.com" },
    "/fetch/resilient": { url: "https://example.com" },
    "/screenshot": { url: "https://example.com" },
    "/search": { query: "x402 protocol", limit: 3 },
    "/extract": { url: "https://example.com", schema: { title: "string" } },
    "/extract/smart": { url: "https://example.com", query: "find the main title" },
    "/research": { query: "autonomous agents", limit: 3 },
    "/batch/fetch": { urls: ["https://example.com", "https://google.com"] },
    "/pdf": { url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf" },
    "/compare": { urls: ["https://example.com", "https://google.com"] },
    "/monitor/create": { url: "https://example.com", webhookUrl: "https://example.com/webhook" },
    "/memory/set": { key: "testnet-test", value: { status: "ok" }, ttl: 1 },
    "/intel/company": { target: "coinbase.com" },
    "/intel/market": { topic: "web3 payments" },
    "/intel/competitive": { company: "stripe.com" },
    "/intel/site-audit": { url: "https://example.com" },
    "/credits/buy": { amount: "$10.00" },
};

async function testEndpoint(
    client: ReturnType<typeof wrapAxiosWithPayment>,
    endpoint: ITestEndpoint
): Promise<boolean> {
    console.log(`\n--- Testing ${endpoint.name} (${endpoint.price}) ---`);
    console.log(`${endpoint.method} ${endpoint.path}`);

    try {
        let response;
        if (endpoint.method === "POST") {
            response = await client.post<IWebLensResponseData>(endpoint.path, endpoint.body);
        } else if (endpoint.method === "DELETE") {
            response = await client.delete<IWebLensResponseData>(endpoint.path);
        } else {
            response = await client.get<IWebLensResponseData>(endpoint.path);
        }

        console.log("✅ Success! Status:", response.status);

        const data = response.data;
        if (data.title) { console.log("  Title:", data.title); }
        if (typeof data.content === "string") { console.log("  Content:", data.content.slice(0, 100) + "..."); }
        if (data.stored !== undefined) { console.log("  Stored:", data.stored); }
        if (data.monitorId) { console.log("  Monitor ID:", data.monitorId); }
        if (data.key) { console.log("  Key:", data.key); }

        const paymentResponse = response.headers["x-payment-response"] as string | undefined;
        if (paymentResponse) {
            const decoded = JSON.parse(Buffer.from(paymentResponse, "base64").toString()) as { transaction?: string };
            console.log("  💰 Tx:", (decoded.transaction ?? "unknown").slice(0, 30) + "...");
        }

        return true;
    } catch (error: unknown) {
        if (axios.isAxiosError(error) && error.response) {
            console.log("❌ Error:", error.response.status);
            console.log("  ", JSON.stringify(error.response.data).slice(0, 300));
        } else {
            const message = error instanceof Error ? error.message : String(error);
            console.error("❌ Error:", message);
        }
        return false;
    }
}

async function run(): Promise<void> {
    const rawPrivateKey = process.env.PRIVATE_KEY;
    if (!rawPrivateKey) {
        throw new Error("❌ Set PRIVATE_KEY environment variable. Example: $env:PRIVATE_KEY='0x...' ; npx tsx scripts/test-payment-testnet.ts");
    }

    const privateKey = rawPrivateKey as Hex;
    const apiUrl = process.env.API_URL ?? "https://api.weblens.dev";

    const account = privateKeyToAccount(privateKey);

    console.log("🧪 TESTNET MODE - Dynamic Endpoint Discovery");
    console.log("🔑 Wallet:", account.address);
    console.log("🌐 API:", apiUrl);

    // Create x402 client and register EVM scheme
    const x402 = new x402Client();
    registerExactEvmScheme(x402, { signer: account });

    const client = wrapAxiosWithPayment(
        axios.create({ baseURL: apiUrl, timeout: 60000 }),
        x402
    );

    // 1. Discover endpoints dynamically
    console.log("\n🔍 Discovering services from /discovery...");
    const discoveryResponse = await axios.get<IDiscoveryResponse>(`${apiUrl}/discovery`);
    const services = discoveryResponse.data.services;
    console.log(`✅ Discovered ${services.length} services.\n`);

    // 2. Prepare test list
    const endpoints: ITestEndpoint[] = services.map((s) => ({
        name: s.name,
        method: s.method,
        path: s.endpoint,
        body: TEST_PAYLOADS[s.endpoint],
        price: s.price,
    }));

    // Add generic credits endpoints (non-facilitated by price but worth checking)
    endpoints.push(
        { name: "Check Balance", method: "GET", path: "/credits/balance", price: "FREE" },
        { name: "Check History", method: "GET", path: "/credits/history", price: "FREE" }
    );

    const results: { name: string; success: boolean; path: string }[] = [];

    // 3. Run tests
    for (const endpoint of endpoints) {
        // Skip paths with dynamic segments like /monitor/:id for now unless we capture IDs
        if (endpoint.path.includes(":") || endpoint.path.includes("*")) {
            console.log(`\n⏩ Skipping dynamic path: ${endpoint.path}`);
            continue;
        }

        const success = await testEndpoint(client, endpoint);
        results.push({ name: endpoint.name, success, path: endpoint.path });
        await sleep(1000);
    }

    console.log("\n" + "=".repeat(50));
    console.log("📊 SUMMARY");
    console.log("=".repeat(50));

    const successful = results.filter((r) => r.success).length;
    results.forEach((r) => {
        console.log(`${r.success ? "✅" : "❌"} ${r.name.padEnd(30)} [${r.path}]`);
    });

    console.log(`\nTotal: ${successful}/${results.length} successful`);

    if (successful === 0 && results.length > 0) {
        throw new Error("❌ All tests failed. Is the server running and accessible?");
    }
}

// Entry point that handles the error without process.exit or eslint-disable
run()
    .then(() => {
        console.log("\n🎉 Test run complete!");
    })
    .catch((e: unknown) => {
        console.error(e instanceof Error ? e.message : String(e));
        throw e;
    });
