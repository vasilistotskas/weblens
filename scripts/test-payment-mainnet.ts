/**
 * Test script for x402 payments on WebLens PRODUCTION (Base Mainnet)
 *
 * Prerequisites:
 * 1. Have USDC on Base mainnet in your wallet
 * 2. Export your wallet private key
 * 3. Run: $env:PRIVATE_KEY='0x...' ; npx tsx scripts/test-payment-mainnet.ts
 *
 * Total cost: ~$0.20 USDC to test all endpoints
 * 
 * IMPORTANT: This uses REAL MONEY on Base mainnet!
 */

import axios from "axios";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, wrapAxiosWithPayment } from "@x402/axios";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import type { Hex } from "viem";

const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex;

if (!PRIVATE_KEY) {
    console.error("❌ Set PRIVATE_KEY environment variable");
    console.log("Example: $env:PRIVATE_KEY='0x...' ; npx tsx scripts/test-payment-mainnet.ts");
    process.exit(1);
}

const API_URL = "https://api.weblens.dev";

interface TestEndpoint {
    name: string;
    method: "GET" | "POST";
    path: string;
    body?: Record<string, unknown>;
    price: string;
}

const ENDPOINTS: TestEndpoint[] = [
    {
        name: "Fetch Basic",
        method: "POST",
        path: "/fetch/basic",
        body: { url: "https://example.com" },
        price: "$0.005",
    },
    {
        name: "Fetch Pro",
        method: "POST",
        path: "/fetch/pro",
        body: { url: "https://example.com" },
        price: "$0.015",
    },
    {
        name: "Screenshot",
        method: "POST",
        path: "/screenshot",
        body: { url: "https://example.com" },
        price: "$0.02",
    },
    {
        name: "Search",
        method: "POST",
        path: "/search",
        body: { query: "x402 payment protocol", limit: 3 },
        price: "$0.005",
    },
    {
        name: "Extract",
        method: "POST",
        path: "/extract",
        body: {
            url: "https://example.com",
            schema: { title: { type: "string" }, description: { type: "string" } },
        },
        price: "$0.03",
    },
    {
        name: "Batch Fetch",
        method: "POST",
        path: "/batch/fetch",
        body: { urls: ["https://example.com", "https://example.org"] },
        price: "$0.006",
    },
    {
        name: "Research",
        method: "POST",
        path: "/research",
        body: { query: "What is x402 payment protocol?", resultCount: 2 },
        price: "$0.05",
    },
    {
        name: "Smart Extract",
        method: "POST",
        path: "/extract/smart",
        body: { url: "https://example.com", query: "find the main heading" },
        price: "$0.02",
    },
    {
        name: "PDF Extract",
        method: "POST",
        path: "/pdf",
        body: { url: "https://www.w3.org/WAI/WCAG21/Techniques/pdf/img/table-word.pdf" },
        price: "$0.01",
    },
    {
        name: "Compare",
        method: "POST",
        path: "/compare",
        body: { urls: ["https://example.com", "https://example.org"] },
        price: "$0.04",
    },
    {
        name: "Memory Set",
        method: "POST",
        path: "/memory/set",
        body: { key: "test-key", value: { message: "hello from test" }, ttl: 1 },
        price: "$0.001",
    },
    {
        name: "Memory List",
        method: "GET",
        path: "/memory/list",
        price: "$0.0005",
    },
];

async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testEndpoint(
    client: ReturnType<typeof wrapAxiosWithPayment>,
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

        // Show relevant response data
        if (response.data.title) console.log("  Title:", response.data.title);
        if (response.data.query) console.log("  Query:", response.data.query);
        if (response.data.results) console.log("  Results:", response.data.results?.length);
        if (response.data.content) console.log("  Content:", response.data.content?.slice(0, 100) + "...");
        if (response.data.image) console.log("  Image: [base64 PNG]", response.data.image?.slice(0, 50) + "...");
        if (response.data.stored !== undefined) console.log("  Stored:", response.data.stored);
        if (response.data.keys) console.log("  Keys:", response.data.keys);

        // Check payment response header
        const paymentResponse = response.headers["x-payment-response"];
        if (paymentResponse) {
            const decoded = JSON.parse(Buffer.from(paymentResponse, "base64").toString());
            console.log("  💰 Tx:", decoded.transaction?.slice(0, 20) + "...");
        }

        return true;
    } catch (error: unknown) {
        if (axios.isAxiosError(error) && error.response) {
            console.log("❌ Error:", error.response.status);
            console.log("  ", JSON.stringify(error.response.data).slice(0, 200));
            
            // Check if it's a 402 with payment requirements
            if (error.response.status === 402) {
                const paymentRequired = error.response.headers["payment-required"];
                if (paymentRequired) {
                    try {
                        const decoded = JSON.parse(Buffer.from(paymentRequired, "base64").toString());
                        console.log("  💳 Payment required for network:", decoded.accepts?.[0]?.network);
                        console.log("  💵 Amount:", decoded.accepts?.[0]?.amount, "wei");
                    } catch {
                        console.log("  💳 Payment required (could not decode header)");
                    }
                }
            }
        } else if (error instanceof Error) {
            console.error("❌ Error:", error.message);
        }
        return false;
    }
}

async function main() {
    const account = privateKeyToAccount(PRIVATE_KEY);
    console.log("🔑 Wallet:", account.address);
    console.log("🌐 API:", API_URL);
    console.log("⚠️  Network: Base Mainnet (REAL MONEY!)");
    console.log(`📋 Testing ${ENDPOINTS.length} endpoints`);

    const totalCost = ENDPOINTS.reduce((sum, e) => {
        const price = parseFloat(e.price.replace("$", ""));
        return sum + price;
    }, 0);
    console.log(`💵 Estimated total cost: ${totalCost.toFixed(4)} USDC`);
    console.log("\n⚠️  Make sure your wallet has at least", totalCost.toFixed(4), "USDC on Base mainnet!");
    console.log("⚠️  USDC contract on Base: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");

    // Create x402 client and register EVM scheme
    const x402 = new x402Client();
    registerExactEvmScheme(x402, { signer: account });

    const client = wrapAxiosWithPayment(
        axios.create({ baseURL: API_URL, timeout: 120000 }),
        x402
    );

    const results: { name: string; success: boolean }[] = [];

    for (const endpoint of ENDPOINTS) {
        const success = await testEndpoint(client, endpoint);
        results.push({ name: endpoint.name, success });
        // Small delay between requests
        await sleep(2000);
    }

    // Summary
    console.log("\n" + "=".repeat(50));
    console.log("📊 SUMMARY");
    console.log("=".repeat(50));

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    results.forEach((r) => {
        console.log(`${r.success ? "✅" : "❌"} ${r.name}`);
    });

    console.log(`\nTotal: ${successful}/${results.length} successful`);
    if (failed > 0) {
        console.log(`⚠️  ${failed} endpoint(s) failed`);
    } else {
        console.log("🎉 All endpoints working!");
    }
}

main();
