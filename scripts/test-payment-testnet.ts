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
 *
 * Optional: Set API_URL to point at a different server (default: https://api.weblens.dev)
 *    $env:API_URL='https://api.weblens.dev' ; $env:PRIVATE_KEY='0x...' ; npx tsx scripts/test-payment-testnet.ts
 *
 * Optional: Skip expensive intel endpoints
 *    $env:SKIP_INTEL='true' ; $env:PRIVATE_KEY='0x...' ; npx tsx scripts/test-payment-testnet.ts
 */

import { x402Client, wrapAxiosWithPayment } from "@x402/axios";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import axios from "axios";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================
// Types
// ============================================

interface ITestEndpoint {
    name: string;
    method: "GET" | "POST" | "DELETE";
    path: string;
    body?: Record<string, unknown>;
    price: string;
    /** If true, use plain axios (no x402). Used for free/system endpoints. */
    free?: boolean;
    /** Query string to append to path (e.g. "?key=foo") */
    query?: string;
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
    deleted?: boolean;
    summary?: unknown;
    services?: IDiscoveryService[];
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

// ============================================
// Test Payloads — must match Zod schemas exactly
// ============================================

/** Payloads for paid POST endpoints, keyed by route path. */
const TEST_PAYLOADS: Record<string, Record<string, unknown>> = {
    // Core endpoints
    "/fetch/basic":    { url: "https://example.com" },
    "/fetch/pro":      { url: "https://example.com" },
    "/fetch/resilient":{ url: "https://example.com" },
    "/screenshot":     { url: "https://example.com" },
    "/search":         { query: "x402 protocol", limit: 3 },
    "/extract": {
        url: "https://example.com",
        schema: { title: { type: "string" }, description: { type: "string" } },
    },
    "/extract/smart":  { url: "https://example.com", query: "find the main title" },

    // Advanced endpoints
    "/research":    { query: "autonomous agents and web3", limit: 3 },
    "/batch/fetch": { urls: ["https://example.com", "https://example.org"] },
    "/pdf":         { url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf" },
    "/compare":     { urls: ["https://example.com", "https://example.org"] },

    // System — paid
    "/monitor/create": {
        url: "https://example.com",
        webhookUrl: "https://example.com/webhook",
        checkInterval: 1,
        notifyOn: "any",
    },
    "/memory/set": {
        key: "testnet-test-key",
        value: { status: "ok", timestamp: Date.now() },
        ttl: 1, // 1 hour minimum
    },

    // Intel endpoints — use "param" field (IntelRequestSchema)
    "/intel/company":    { param: "coinbase.com", depth: "basic" },
    "/intel/market":     { param: "web3 payments", depth: "basic" },
    "/intel/competitive":{ param: "stripe.com", depth: "basic" },
    "/intel/site-audit": { param: "https://example.com", depth: "basic" },

    // Credits — amount must be a number (USD)
    "/credits/buy": { amount: 5 },
};

// ============================================
// Test Runner
// ============================================

async function testEndpoint(
    client: ReturnType<typeof wrapAxiosWithPayment>  ,
    endpoint: ITestEndpoint,
    baseAxios: ReturnType<typeof axios.create>
): Promise<{ success: boolean; data?: IWebLensResponseData }> {
    const displayPath = endpoint.query ? endpoint.path + endpoint.query : endpoint.path;
    console.log(`\n--- Testing ${endpoint.name} (${endpoint.price}) ---`);
    console.log(`${endpoint.method} ${displayPath}${endpoint.free ? " [FREE]" : ""}`);

    // Free endpoints always use plain axios to avoid x402 wrapping overhead
    const httpClient = endpoint.free ? baseAxios : client;
    const fullPath = endpoint.query ? endpoint.path + endpoint.query : endpoint.path;

    try {
        let response;
        if (endpoint.method === "POST") {
            response = await (httpClient).post<IWebLensResponseData>(fullPath, endpoint.body ?? {});
        } else if (endpoint.method === "DELETE") {
            response = await (httpClient).delete<IWebLensResponseData>(fullPath);
        } else {
            response = await (httpClient).get<IWebLensResponseData>(fullPath);
        }

        console.log("✅ Success! Status:", response.status);

        const data = response.data;
        if (data.title) { console.log("  Title:", data.title); }
        if (typeof data.content === "string") { console.log("  Content:", data.content.slice(0, 100) + "..."); }
        if (data.stored !== undefined) { console.log("  Stored:", data.stored); }
        if (data.deleted !== undefined) { console.log("  Deleted:", data.deleted); }
        if (data.monitorId) { console.log("  Monitor ID:", data.monitorId); }
        if (data.key) { console.log("  Key:", data.key); }
        if (data.balance !== undefined) { console.log("  Balance:", data.balance); }
        if (data.keys) { console.log("  Keys:", data.keys); }
        if (Array.isArray(data.results)) { console.log("  Results:", data.results.length, "items"); }
        if (Array.isArray(data.services)) { console.log("  Services:", data.services.length, "items"); }

        const paymentResponse = response.headers["x-payment-response"] as string | undefined;
        if (paymentResponse) {
            try {
                const decoded = JSON.parse(Buffer.from(paymentResponse, "base64").toString()) as { transaction?: string };
                if (decoded.transaction) {
                    console.log("  💰 Tx:", decoded.transaction.slice(0, 30) + "...");
                }
            } catch {
                // ignore decode errors
            }
        }

        return { success: true, data };
    } catch (error: unknown) {
        if (axios.isAxiosError(error) && error.response) {
            console.log("❌ Error:", error.response.status);
            console.log("  ", JSON.stringify(error.response.data).slice(0, 300));
        } else {
            const message = error instanceof Error ? error.message : String(error);
            console.error("❌ Error:", message);
        }
        return { success: false };
    }
}

// ============================================
// Main
// ============================================

async function run(): Promise<void> {
    const rawPrivateKey = process.env.PRIVATE_KEY;
    if (!rawPrivateKey) {
        throw new Error(
            "❌ Set PRIVATE_KEY environment variable.\n" +
            "   Example: $env:PRIVATE_KEY='0x...' ; npx tsx scripts/test-payment-testnet.ts"
        );
    }

    const privateKey = rawPrivateKey as Hex;
    const apiUrl = process.env.API_URL ?? "https://api.weblens.dev";
    const skipIntel = process.env.SKIP_INTEL === "true";

    const account = privateKeyToAccount(privateKey);

    console.log("🧪 WebLens Full API Test Suite");
    console.log("🔑 Wallet:", account.address);
    console.log("🌐 API:", apiUrl);
    if (skipIntel) { console.log("⏩ Skipping intel endpoints (SKIP_INTEL=true)"); }

    // Plain axios for free/system endpoints
    const baseAxios = axios.create({ baseURL: apiUrl, timeout: 60000 });

    // x402 client for paid endpoints
    const x402 = new x402Client();
    registerExactEvmScheme(x402, { signer: account });
    const paidClient = wrapAxiosWithPayment(
        axios.create({ baseURL: apiUrl, timeout: 60000 }),
        x402
    );

    // ============================================
    // 1. Free & System Endpoints (no payment)
    // ============================================
    const freeEndpoints: ITestEndpoint[] = [
        { name: "Health Check",     method: "GET",  path: "/health",    price: "FREE", free: true },
        { name: "Root Info",        method: "GET",  path: "/",          price: "FREE", free: true },
        { name: "Discovery",        method: "GET",  path: "/discovery", price: "FREE", free: true },
        { name: "MCP Info",         method: "GET",  path: "/mcp/info",  price: "FREE", free: true },
        { name: "Free Fetch",       method: "POST", path: "/free/fetch",  price: "FREE", free: true, body: { url: "https://example.com" } },
        { name: "Free Search",      method: "POST", path: "/free/search", price: "FREE", free: true, body: { query: "x402 protocol", limit: 3 } },
        { name: "Credits Balance",  method: "GET",  path: "/credits/balance", price: "FREE", free: true },
        { name: "Credits History",  method: "GET",  path: "/credits/history", price: "FREE", free: true },
        { name: "Memory List",      method: "GET",  path: "/memory/list", price: "FREE", free: true },
    ];

    // ============================================
    // 2. Discover paid endpoints dynamically
    // ============================================
    console.log("\n🔍 Discovering paid services from /discovery...");
    let discoveredEndpoints: ITestEndpoint[] = [];
    try {
        const discoveryResponse = await baseAxios.get<IDiscoveryResponse>("/discovery");
        const services = discoveryResponse.data.services;
        console.log(`✅ Discovered ${services.length} services.`);

        discoveredEndpoints = services
            .filter((s) => {
                // Skip paths with dynamic segments — handled separately below
                if (s.endpoint.includes(":") || s.endpoint.includes("*")) { return false; }
                // Skip intel if requested
                if (skipIntel && s.endpoint.startsWith("/intel/")) { return false; }
                return true;
            })
            .map((s) => ({
                name: s.name,
                method: s.method,
                path: s.endpoint,
                body: TEST_PAYLOADS[s.endpoint],
                price: s.price,
            }));
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`⚠️  Could not reach /discovery: ${msg}`);
        console.warn("   Falling back to hardcoded endpoint list.");

        // Hardcoded fallback — mirrors all route registrations
        const fallbackPaths = [
            "/fetch/basic", "/fetch/pro", "/fetch/resilient",
            "/screenshot", "/search", "/extract", "/extract/smart",
            "/research", "/batch/fetch", "/pdf", "/compare",
            "/monitor/create", "/memory/set", "/credits/buy",
            ...(!skipIntel ? ["/intel/company", "/intel/market", "/intel/competitive", "/intel/site-audit"] : []),
        ];

        discoveredEndpoints = fallbackPaths.map((path) => ({
            name: path,
            method: "POST" as const,
            path,
            body: TEST_PAYLOADS[path],
            price: "unknown",
        }));
    }

    // ============================================
    // 3. Run tests and collect state for chained tests
    // ============================================
    const results: { name: string; success: boolean; path: string }[] = [];
    let capturedMonitorId: string | undefined;
    const MEMORY_TEST_KEY = "testnet-test-key";

    // --- Free / system endpoints ---
    console.log("\n" + "=".repeat(50));
    console.log("📋 FREE & SYSTEM ENDPOINTS");
    console.log("=".repeat(50));

    for (const ep of freeEndpoints) {
        const { success } = await testEndpoint(paidClient, ep, baseAxios);
        results.push({ name: ep.name, success, path: ep.path });
        await sleep(300);
    }

    // --- Paid endpoints from discovery ---
    console.log("\n" + "=".repeat(50));
    console.log("💳 PAID ENDPOINTS");
    console.log("=".repeat(50));

    for (const ep of discoveredEndpoints) {
        if (!ep.body && ep.method === "POST") {
            console.log(`\n⚠️  No test payload for ${ep.path} — skipping`);
            continue;
        }

        const { success, data } = await testEndpoint(paidClient, ep, baseAxios);
        results.push({ name: ep.name, success, path: ep.path });

        // Capture monitor ID for chained test
        if (ep.path === "/monitor/create" && success && data?.monitorId) {
            capturedMonitorId = data.monitorId;
            console.log("  📌 Captured monitorId:", capturedMonitorId);
        }

        await sleep(1000); // throttle between paid requests
    }

    // ============================================
    // 4. Chained tests — depend on state from above
    // ============================================
    console.log("\n" + "=".repeat(50));
    console.log("🔗 CHAINED / STATEFUL TESTS");
    console.log("=".repeat(50));

    // Memory: get → delete (key was set in paid endpoints above)
    const memoryGetEp: ITestEndpoint = {
        name: "Memory Get (by key param)",
        method: "GET",
        path: `/memory/get`,
        query: `?key=${encodeURIComponent(MEMORY_TEST_KEY)}`,
        price: "FREE",
        free: true,
    };
    const { success: memGetOk } = await testEndpoint(paidClient, memoryGetEp, baseAxios);
    results.push({ name: memoryGetEp.name, success: memGetOk, path: memoryGetEp.path + (memoryGetEp.query ?? "") });
    await sleep(300);

    const memoryDeleteEp: ITestEndpoint = {
        name: "Memory Delete (by key param)",
        method: "DELETE",
        path: `/memory/delete`,
        query: `?key=${encodeURIComponent(MEMORY_TEST_KEY)}`,
        price: "FREE",
        free: true,
    };
    const { success: memDelOk } = await testEndpoint(paidClient, memoryDeleteEp, baseAxios);
    results.push({ name: memoryDeleteEp.name, success: memDelOk, path: memoryDeleteEp.path + (memoryDeleteEp.query ?? "") });
    await sleep(300);

    // Monitor: get → delete (requires capturedMonitorId from /monitor/create)
    if (capturedMonitorId) {
        const monitorGetEp: ITestEndpoint = {
            name: "Monitor Get",
            method: "GET",
            path: `/monitor/${capturedMonitorId}`,
            price: "FREE",
            free: true,
        };
        const { success: monGetOk } = await testEndpoint(paidClient, monitorGetEp, baseAxios);
        results.push({ name: monitorGetEp.name, success: monGetOk, path: monitorGetEp.path });
        await sleep(300);

        const monitorDeleteEp: ITestEndpoint = {
            name: "Monitor Delete",
            method: "DELETE",
            path: `/monitor/${capturedMonitorId}`,
            price: "FREE",
            free: true,
        };
        const { success: monDelOk } = await testEndpoint(paidClient, monitorDeleteEp, baseAxios);
        results.push({ name: monitorDeleteEp.name, success: monDelOk, path: monitorDeleteEp.path });
        await sleep(300);
    } else {
        console.log("\n⏩ Skipping Monitor Get/Delete — no monitorId captured (monitor/create may have failed)");
    }

    // ============================================
    // 5. Summary
    // ============================================
    console.log("\n" + "=".repeat(50));
    console.log("📊 SUMMARY");
    console.log("=".repeat(50));

    const successful = results.filter((r) => r.success).length;
    const maxNameLen = Math.max(...results.map((r) => r.name.length), 10);

    results.forEach((r) => {
        console.log(`${r.success ? "✅" : "❌"} ${r.name.padEnd(maxNameLen + 2)} [${r.path}]`);
    });

    console.log(`\nTotal: ${successful}/${results.length} successful`);

    if (successful === 0 && results.length > 0) {
        throw new Error("❌ All tests failed. Is the server running and accessible?");
    }
}

// Entry point
run()
    .then(() => {
        console.log("\n🎉 Test run complete!");
    })
    .catch((e: unknown) => {
        console.error(e instanceof Error ? e.message : String(e));
        throw e;
    });
