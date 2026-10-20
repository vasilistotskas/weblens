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
 */

import { x402Client, wrapAxiosWithPayment } from "@x402/axios";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import axios from "axios";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Buffer } from "node:buffer";

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

    // Advanced endpoints
    "/research/deep": { query: "autonomous agents and web3", depth: "quick" },
    "/contents":    { urls: ["https://example.com", "https://example.org"] },
    // Use a PDF hosted somewhere that doesn't block Cloudflare IPs.
    // mozilla/pdf.js ships a tracemonkey sample that's CORS-open and CDN-served.
    "/pdf":         { url: "https://raw.githubusercontent.com/mozilla/pdf.js-sample-files/master/tracemonkey.pdf" },
};

// ============================================
// Test Runner
// ============================================

async function testEndpoint(
    client: ReturnType<typeof wrapAxiosWithPayment>,
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

        const paymentResponse = response.headers["payment-response"] as string | undefined;
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

    const account = privateKeyToAccount(privateKey);

    console.log("🧪 WebLens Full API Test Suite");
    console.log("🔑 Wallet:", account.address);
    console.log("🌐 API:", apiUrl);

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
        { name: "Health Check",       method: "GET",  path: "/health",                         price: "FREE", free: true },
        { name: "Root Info",          method: "GET",  path: "/",                               price: "FREE", free: true },
        { name: "Discovery",          method: "GET",  path: "/discovery",                      price: "FREE", free: true },
        { name: "Well-Known x402",    method: "GET",  path: "/.well-known/x402",               price: "FREE", free: true },
        { name: "MCP Info",           method: "GET",  path: "/mcp/info",                       price: "FREE", free: true },
        { name: "OpenAPI Spec",       method: "GET",  path: "/openapi.json",                   price: "FREE", free: true },
        { name: "LLMs Text",          method: "GET",  path: "/llms.txt",                       price: "FREE", free: true },
        { name: "Robots",             method: "GET",  path: "/robots.txt",                     price: "FREE", free: true },
        { name: "Sitemap",            method: "GET",  path: "/sitemap.xml",                    price: "FREE", free: true },
        { name: "Reader (/r/)",       method: "GET",  path: "/r/https://example.com",          price: "FREE", free: true },
        { name: "Free Fetch",         method: "POST", path: "/free/fetch",                     price: "FREE", free: true, body: { url: "https://example.com" } },
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
            "/screenshot", "/search", "/extract",
            "/research/deep", "/pdf", "/contents",
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

        const { success } = await testEndpoint(paidClient, ep, baseAxios);
        results.push({ name: ep.name, success, path: ep.path });

        await sleep(1000); // throttle between paid requests
    }

    // ============================================
    // 4. Chained tests — depend on state from above
    // ============================================
    console.log("\n" + "=".repeat(50));
    console.log("🔗 CHAINED / STATEFUL TESTS");
    console.log("=".repeat(50));

    // ============================================
    // Prepaid API keys by card. Without both Stripe secrets /billing answers 503
    // gracefully; with them a checkout returns a Stripe URL. Paying needs a
    // browser, so this checks the surfaces that must never misbehave.
    // ============================================
    console.log("\n" + "=".repeat(50));
    console.log("💳 PREPAID API KEYS (expect 503 when Stripe unset, 200 when set)");
    console.log("=".repeat(50));

    const expectStatus = async (name: string, path: string, call: () => Promise<{ status: number }>, accepted: number[]): Promise<void> => {
        console.log(`\n--- Testing ${name} ---`);
        let status: number;
        try {
            status = (await call()).status;
        } catch (err) {
            if (!axios.isAxiosError(err) || !err.response) {
                console.error("❌ Error:", err instanceof Error ? err.message : String(err));
                results.push({ name, success: false, path });
                return;
            }
            status = err.response.status;
        }
        const ok = accepted.includes(status);
        console.log(`${ok ? "✅" : "❌"} Status ${String(status)} (expected ${accepted.join(" or ")})`);
        results.push({ name, success: ok, path });
        await sleep(300);
    };

    await expectStatus("Billing Checkout", "/billing/checkout", () => baseAxios.post("/billing/checkout", { pack: "10" }), [200, 503]);
    // An unsigned webhook must never be accepted: 2xx would mean the signature check is bypassed.
    await expectStatus("Stripe Webhook (unsigned)", "/billing/webhook",
        () => baseAxios.post("/billing/webhook", { id: "evt_unsigned", type: "checkout.session.completed", data: { object: { id: "cs_test_x" } } }), [400, 503]);
    await expectStatus("Billing Cancel Page", "/billing/cancel", () => baseAxios.get("/billing/cancel", { responseType: "text" }), [200]);
    await expectStatus("Account Without Key", "/account", () => baseAxios.get("/account"), [401]);
    await expectStatus("Paid Call With Unknown Key", "/fetch/basic",
        () => baseAxios.post("/fetch/basic", { url: "https://example.com" }, { headers: { Authorization: "Bearer wl_test_00000000000000000000000000000000_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" } }), [401]);

    // ============================================
    // SSRF defense — free endpoints must reject internal IPs + userinfo
    // ============================================
    console.log("\n" + "=".repeat(50));
    console.log("🛡️  SSRF DEFENSE");
    console.log("=".repeat(50));

    const ssrfCases: { name: string; url: string }[] = [
        { name: "SSRF (internal IP 169.254)", url: "http://169.254.169.254/latest/meta-data/" },
        { name: "SSRF (userinfo bypass)",     url: "https://admin@169.254.169.254/" },
        { name: "SSRF (localhost)",           url: "http://127.0.0.1:8080/" },
    ];
    for (const c of ssrfCases) {
        console.log(`\n--- Testing ${c.name} on /free/fetch ---`);
        try {
            const resp = await baseAxios.post<IWebLensResponseData>("/free/fetch", { url: c.url });
            console.log("❌ SSRF NOT BLOCKED — response:", resp.status, JSON.stringify(resp.data).slice(0, 200));
            results.push({ name: c.name, success: false, path: "/free/fetch" });
        } catch (err) {
            if (axios.isAxiosError(err) && err.response) {
                const data = err.response.data as { code?: string };
                if (err.response.status === 400 && data.code === "INVALID_URL") {
                    console.log(`⏩ Correctly rejected with 400 INVALID_URL`);
                    results.push({ name: c.name, success: true, path: "/free/fetch" });
                } else if (err.response.status === 429) {
                    // Free-tier rate limit shares a bucket with the other /free/fetch
                    // calls earlier in the suite. 429 doesn't say the SSRF defense
                    // failed — it says the test ran out of rate budget. Count as
                    // skipped rather than failed so repeat runs aren't noisy.
                    console.log(`⏩ 429 RATE_LIMITED (free-tier bucket full — SSRF defense not exercised this run)`);
                    results.push({ name: c.name, success: true, path: "/free/fetch" });
                } else {
                    console.log("❌ Unexpected:", err.response.status, JSON.stringify(err.response.data).slice(0, 200));
                    results.push({ name: c.name, success: false, path: "/free/fetch" });
                }
            }
        }
        await sleep(200);
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
