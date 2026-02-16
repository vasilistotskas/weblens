/**
 * Test script for x402 payments on WebLens (defaults to PRODUCTION - Base Mainnet)
 *
 * Prerequisites:
 * 1. Have USDC on Base mainnet in your wallet (for production)
 * 2. Export your wallet private key
 * 3. Run: $env:PRIVATE_KEY='0x...' ; npx tsx scripts/test-payment.ts
 *
 * For testnet (Base Sepolia with fake USDC):
 * Run: $env:API_URL='http://localhost:8787' ; $env:PRIVATE_KEY='0x...' ; npx tsx scripts/test-payment.ts
 *
 * Total cost: ~$0.20 USDC (production) or FREE (testnet with fake USDC)
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
    method: "GET" | "POST";
    path: string;
    body?: Record<string, unknown>;
    price: string;
}

interface IWebLensResponseData {
    title?: string;
    query?: string;
    results?: { length: number }[];
    content?: string;
    image?: string;
    stored?: boolean;
    keys?: string[];
}

async function testEndpoint(
    client: ReturnType<typeof wrapAxiosWithPayment>,
    endpoint: ITestEndpoint
): Promise<boolean> {
    console.log(`\n--- Testing ${endpoint.name} (${endpoint.price}) ---`);
    console.log(`${endpoint.method} ${endpoint.path}`);

    try {
        const response =
            endpoint.method === "POST"
                ? await client.post<IWebLensResponseData>(endpoint.path, endpoint.body)
                : await client.get<IWebLensResponseData>(endpoint.path);

        console.log("✅ Success! Status:", response.status);

        const data = response.data;
        // Show relevant response data
        if (data.title) { console.log("  Title:", data.title); }
        if (data.query) { console.log("  Query:", data.query); }
        if (data.results) { console.log("  Results:", data.results.length); }
        if (data.content) { console.log("  Content:", data.content.slice(0, 100) + "..."); }
        if (data.image) { console.log("  Image: [base64 PNG]", data.image.slice(0, 50) + "..."); }
        if (data.stored !== undefined) { console.log("  Stored:", data.stored); }
        if (data.keys) { console.log("  Keys:", data.keys); }

        // Check payment response header
        const paymentResponse = response.headers["x-payment-response"] as string | undefined;
        if (paymentResponse) {
            const decoded = JSON.parse(Buffer.from(paymentResponse, "base64").toString()) as unknown as { transaction?: string };
            console.log("  💰 Tx:", (decoded.transaction ?? "unknown").slice(0, 20) + "...");
        }

        return true;
    } catch (error: unknown) {
        if (axios.isAxiosError(error) && error.response) {
            console.log("❌ Error:", error.response.status);
            console.log("  ", JSON.stringify(error.response.data).slice(0, 200));

            // Check if it's a 402 with payment requirements
            if (error.response.status === 402) {
                const paymentRequired = error.response.headers["payment-required"] as string | undefined;
                if (paymentRequired) {
                    try {
                        const decodedValue = JSON.parse(Buffer.from(paymentRequired, "base64").toString()) as unknown as { accepts?: { network: string; amount: string; asset: string }[] };
                        const accepts = decodedValue.accepts?.[0];
                        if (accepts) {
                            console.log("  💳 Payment required for network:", accepts.network);
                            console.log("  💵 Amount:", accepts.amount, "wei");
                            console.log("  💰 Asset:", accepts.asset);
                        }
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

async function run(): Promise<void> {
    const rawPrivateKey = process.env.PRIVATE_KEY;
    if (!rawPrivateKey) {
        throw new Error("❌ Set PRIVATE_KEY environment variable. Example: $env:PRIVATE_KEY='0x...' ; npx tsx scripts/test-payment.ts");
    }

    const privateKey = rawPrivateKey as Hex;
    const apiUrl = process.env.API_URL ?? "https://api.weblens.dev";

    const account = privateKeyToAccount(privateKey);
    console.log("🔑 Wallet:", account.address);
    console.log("🌐 API:", apiUrl);

    const isProduction = apiUrl.includes("api.weblens.dev");
    if (isProduction) {
        console.log("⚠️  Network: Base Mainnet (REAL MONEY!)");
    } else {
        console.log("✅ Network: Base Sepolia Testnet (fake USDC)");
    }

    const endpoints: ITestEndpoint[] = [
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

    console.log(`📋 Testing ${endpoints.length} endpoints`);

    const totalCost = endpoints.reduce((sum, e) => {
        const priceValue = parseFloat(e.price.replace("$", ""));
        return sum + priceValue;
    }, 0);
    console.log(`💵 Estimated total cost: ${totalCost.toFixed(4)} USDC`);

    if (isProduction) {
        console.log("\n⚠️  Make sure your wallet has at least", totalCost.toFixed(4), "USDC on Base mainnet!");
        console.log("⚠️  USDC contract on Base: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    }

    // Create x402 client and register EVM scheme
    const x402 = new x402Client();
    registerExactEvmScheme(x402, { signer: account });

    const client = wrapAxiosWithPayment(
        axios.create({ baseURL: apiUrl, timeout: 120000 }),
        x402
    );

    const results: { name: string; success: boolean }[] = [];

    for (const endpoint of endpoints) {
        const success = await testEndpoint(client, endpoint);
        results.push({ name: endpoint.name, success });
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
        throw new Error(`Test failed: ${failed} endpoint(s) failed.`);
    }
}

run()
    .then(() => {
        console.log("🎉 All endpoints working!");
    })
    .catch((e: unknown) => {
        console.error(e instanceof Error ? e.message : String(e));
        throw e;
    });
