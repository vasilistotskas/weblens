/**
 * Validation script to check if WebLens endpoints are properly configured for Bazaar discovery
 * 
 * This script:
 * 1. Makes a request to each endpoint to get the 402 response
 * 2. Extracts the Bazaar discovery extension from the PAYMENT-REQUIRED header
 * 3. Validates the extension using validateDiscoveryExtension
 * 4. Reports any validation errors
 * 
 * Run: npx tsx scripts/validate-bazaar.ts
 */

import axios from "axios";
import { validateDiscoveryExtension, validateAndExtract } from "@x402/extensions/bazaar";

const API_URL = process.env.API_URL || "https://api.weblens.dev";

interface TestEndpoint {
    name: string;
    method: "GET" | "POST";
    path: string;
    body?: Record<string, unknown>;
}

const ENDPOINTS: TestEndpoint[] = [
    { name: "Fetch Basic", method: "POST", path: "/fetch/basic", body: { url: "https://example.com" } },
    { name: "Fetch Pro", method: "POST", path: "/fetch/pro", body: { url: "https://example.com" } },
    { name: "Screenshot", method: "POST", path: "/screenshot", body: { url: "https://example.com" } },
    { name: "Search", method: "POST", path: "/search", body: { query: "test" } },
    { name: "Extract", method: "POST", path: "/extract", body: { url: "https://example.com", schema: {} } },
    { name: "Batch Fetch", method: "POST", path: "/batch/fetch", body: { urls: ["https://example.com"] } },
    { name: "Research", method: "POST", path: "/research", body: { query: "test" } },
    { name: "Smart Extract", method: "POST", path: "/extract/smart", body: { url: "https://example.com", query: "test" } },
    { name: "PDF Extract", method: "POST", path: "/pdf", body: { url: "https://example.com/doc.pdf" } },
    { name: "Compare", method: "POST", path: "/compare", body: { urls: ["https://example.com"] } },
    { name: "Monitor Create", method: "POST", path: "/monitor/create", body: { url: "https://example.com", webhookUrl: "https://example.com/webhook" } },
    { name: "Memory Set", method: "POST", path: "/memory/set", body: { key: "test", value: {} } },
    { name: "Memory Get", method: "GET", path: "/memory/list" },
    { name: "Memory List", method: "GET", path: "/memory/list" },
];

async function validateEndpoint(endpoint: TestEndpoint): Promise<{ valid: boolean; errors?: string[] }> {
    console.log(`\n🔍 Validating ${endpoint.name} (${endpoint.method} ${endpoint.path})...`);

    try {
        // Make request to get 402 response
        const response = await axios({
            method: endpoint.method,
            url: `${API_URL}${endpoint.path}`,
            data: endpoint.body,
            headers: { "Content-Type": "application/json" },
            validateStatus: () => true, // Don't throw on 402
        });

        if (response.status !== 402) {
            console.log(`  ⚠️  Expected 402, got ${response.status}`);
            return { valid: false, errors: [`Expected 402 status, got ${response.status}`] };
        }

        // Extract PAYMENT-REQUIRED header
        const paymentRequiredHeader = response.headers["payment-required"];
        if (!paymentRequiredHeader) {
            console.log("  ❌ No PAYMENT-REQUIRED header found");
            return { valid: false, errors: ["Missing PAYMENT-REQUIRED header"] };
        }

        // Decode Base64
        const paymentRequired = JSON.parse(Buffer.from(paymentRequiredHeader, "base64").toString());

        // Check if Bazaar extension exists
        if (!paymentRequired.extensions?.bazaar) {
            console.log("  ❌ No Bazaar extension found");
            return { valid: false, errors: ["Missing Bazaar extension"] };
        }

        const bazaarExtension = paymentRequired.extensions.bazaar;

        // Validate using x402 SDK
        const result = validateAndExtract(bazaarExtension);

        if (result.valid && result.info) {
            console.log("  ✅ Valid Bazaar discovery extension");
            console.log(`     Method: ${result.info.input.method}`);
            console.log(`     Type: ${result.info.input.type}`);
            if ("bodyType" in result.info.input) {
                console.log(`     Body Type: ${result.info.input.bodyType}`);
            }
            if (result.info.output?.example) {
                console.log(`     Has output example: ✅`);
            }
            return { valid: true };
        } else {
            console.log("  ❌ Validation failed");
            if (result.errors) {
                result.errors.forEach((error) => console.log(`     - ${error}`));
            }
            return { valid: false, errors: result.errors };
        }
    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.log(`  ❌ Request failed: ${error.message}`);
            return { valid: false, errors: [error.message] };
        }
        throw error;
    }
}

async function main() {
    console.log("🎯 WebLens Bazaar Discovery Validation");
    console.log("=====================================");
    console.log(`API URL: ${API_URL}`);
    console.log(`Testing ${ENDPOINTS.length} endpoints\n`);

    const results: { name: string; valid: boolean; errors?: string[] }[] = [];

    for (const endpoint of ENDPOINTS) {
        const result = await validateEndpoint(endpoint);
        results.push({ name: endpoint.name, valid: result.valid, errors: result.errors });
    }

    // Summary
    console.log("\n" + "=".repeat(50));
    console.log("📊 VALIDATION SUMMARY");
    console.log("=".repeat(50));

    const valid = results.filter((r) => r.valid).length;
    const invalid = results.filter((r) => !r.valid).length;

    results.forEach((r) => {
        console.log(`${r.valid ? "✅" : "❌"} ${r.name}`);
        if (!r.valid && r.errors) {
            r.errors.forEach((error) => console.log(`   - ${error}`));
        }
    });

    console.log(`\nTotal: ${valid}/${results.length} valid`);

    if (invalid > 0) {
        console.log(`⚠️  ${invalid} endpoint(s) have validation errors`);
        process.exit(1);
    } else {
        console.log("🎉 All endpoints are properly configured for Bazaar discovery!");
    }
}

main().catch((error) => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
});
