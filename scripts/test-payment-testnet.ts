/**
 * Test script for x402 payments using Base Sepolia TESTNET
 *
 * Prerequisites:
 * 1. Get testnet USDC from faucet: https://faucet.circle.com/ (select Base Sepolia)
 * 2. Get testnet ETH from: https://www.alchemy.com/faucets/base-sepolia
 * 3. Start local dev server with testnet config:
 *    wrangler dev --env testnet
 * 4. Run this script:
 *    $env:PRIVATE_KEY='0x...' ; npx ts-node scripts/test-payment-testnet.ts
 *
 * This uses FAKE money - no real funds required!
 * 
 * Testnet USDC contract on Base Sepolia: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
 */

import axios from "axios";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { withPaymentInterceptor } from "x402-axios";
import type { Hex } from "viem";

const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex;

if (!PRIVATE_KEY) {
    console.error("❌ Set PRIVATE_KEY environment variable");
    console.log("Example: $env:PRIVATE_KEY='0x...' ; npx ts-node scripts/test-payment-testnet.ts");
    process.exit(1);
}

// Local dev server or testnet deployment
const API_URL = process.env.API_URL || "http://localhost:8787";

interface TestEndpoint {
    name: string;
    method: "GET" | "POST";
    path: string;
    body?: Record<string, unknown>;
    price: string;
}

// Test just a few endpoints to verify payments work
const ENDPOINTS: TestEndpoint[] = [
    {
        name: "Fetch Basic",
        method: "POST",
        path: "/fetch/basic",
        body: { url: "https://example.com" },
        price: "$0.005",
    },
    {
        name: "Search",
        method: "POST",
        path: "/search",
        body: { query: "test query", limit: 3 },
        price: "$0.005",
    },
    {
        name: "Memory Set",
        method: "POST",
        path: "/memory/set",
        body: { key: "test-key", value: { message: "hello" }, ttl: 1 },
        price: "$0.001",
    },
];

async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testEndpoint(
    client: ReturnType<typeof withPaymentInterceptor>,
    endpoint: TestEndpoint
): Promise<boolean> {
    console.log(`\n--- Testing ${endpoint.name} (${endpoint.price}) ---`);
    console.log(`${endpoint.method} ${endpoint.path}`);

    try {
        const response =
            endpoint.method === "POST"
                ? await client.post(endpoint.path, endpoint.body)
                : await client.get(endpoint.path);

        console.log("✅ Success! Status:", response.status);

        if (response.data.title) console.log("  Title:", response.data.title);
        if (response.data.content) console.log("  Content:", response.data.content?.slice(0, 100) + "...");
        if (response.data.stored !== undefined) console.log("  Stored:", response.data.stored);

        const paymentResponse = response.headers["x-payment-response"];
        if (paymentResponse) {
            const decoded = JSON.parse(Buffer.from(paymentResponse, "base64").toString());
            console.log("  💰 Tx:", decoded.transaction?.slice(0, 30) + "...");
        }

        return true;
    } catch (error: any) {
        if (error.response) {
            console.log("❌ Error:", error.response.status);
            console.log("  ", JSON.stringify(error.response.data).slice(0, 300));
        } else {
            console.error("❌ Error:", error.message);
        }
        return false;
    }
}

async function main() {
    const account = privateKeyToAccount(PRIVATE_KEY);

    // Use Base Sepolia TESTNET
    const walletClient = createWalletClient({
        account,
        chain: baseSepolia,
        transport: http(),
    });

    console.log("🧪 TESTNET MODE - Using fake money!");
    console.log("🔑 Wallet:", account.address);
    console.log("⛓️  Chain:", baseSepolia.name, `(chainId: ${baseSepolia.id})`);
    console.log("🌐 API:", API_URL);
    console.log("");
    console.log("📝 Get testnet USDC: https://faucet.circle.com/ (select Base Sepolia)");
    console.log("📝 Get testnet ETH:  https://www.alchemy.com/faucets/base-sepolia");
    console.log("");

    const client = withPaymentInterceptor(
        axios.create({ baseURL: API_URL, timeout: 60000 }),
        walletClient as any
    );

    const results: { name: string; success: boolean }[] = [];

    for (const endpoint of ENDPOINTS) {
        const success = await testEndpoint(client, endpoint);
        results.push({ name: endpoint.name, success });
        await sleep(1000);
    }

    console.log("\n" + "=".repeat(50));
    console.log("📊 SUMMARY");
    console.log("=".repeat(50));

    const successful = results.filter((r) => r.success).length;
    results.forEach((r) => {
        console.log(`${r.success ? "✅" : "❌"} ${r.name}`);
    });

    console.log(`\nTotal: ${successful}/${results.length} successful`);
}

main();
