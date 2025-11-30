/**
 * Verify WebLens Bazaar Listing
 *
 * This script checks if WebLens endpoints are properly listed in the
 * Coinbase Bazaar discovery catalog.
 *
 * Usage:
 *   npx ts-node scripts/verify-bazaar.ts
 */

interface BazaarResource {
  resource: string;
  payTo: string;
  scheme: string;
  network: string;
  maxAmountRequired: string;
  asset: string;
  accepts?: {
    network: string;
    maxAmountRequired: string;
    asset: string;
  }[];
  inputSchema?: unknown;
  outputSchema?: unknown;
  metadata?: {
    description?: string;
    discoverable?: boolean;
  };
}

interface BazaarResponse {
  resources: BazaarResource[];
}

const BAZAAR_ENDPOINT = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";

const EXPECTED_ENDPOINTS = [
  "/fetch/basic",
  "/fetch/pro",
  "/screenshot",
  "/search",
  "/extract",
  "/batch/fetch",
  "/research",
  "/extract/smart",
  "/pdf",
  "/compare",
  "/monitor/create",
  "/memory/set",
  "/memory/get",
  "/memory/list",
];

async function verifyBazaarListing() {
  console.log("🔍 Checking Coinbase Bazaar for WebLens listings...\n");

  try {
    const response = await fetch(BAZAAR_ENDPOINT);

    if (!response.ok) {
      console.error(`❌ Failed to fetch Bazaar: ${response.status} ${response.statusText}`);
      process.exit(1);
    }

    const data = await response.json() as BazaarResponse;

    console.log(`✅ Successfully fetched Bazaar catalog`);
    console.log(`📊 Total resources in Bazaar: ${data.resources.length}\n`);

    // Filter for WebLens resources (containing "weblens" or our wallet)
    const weblensResources = data.resources.filter((resource) =>
      resource.resource.includes("weblens") ||
      resource.resource.includes("api.weblens.dev")
    );

    if (weblensResources.length === 0) {
      console.log("❌ No WebLens resources found in Bazaar!");
      console.log("\n🔧 Troubleshooting:");
      console.log("   1. Ensure you're using the CDP facilitator from @coinbase/x402");
      console.log("   2. Verify CDP_API_KEY_ID and CDP_API_KEY_SECRET are set");
      console.log("   3. Check that discoverable: true is set on all endpoints");
      console.log("   4. Deploy your changes: npm run deploy");
      console.log("   5. Wait 5-10 minutes for Bazaar indexing");
      process.exit(1);
    }

    console.log(`✅ Found ${weblensResources.length} WebLens resources in Bazaar!\n`);

    // Check each expected endpoint
    const foundEndpoints: string[] = [];
    const missingEndpoints: string[] = [];

    for (const endpoint of EXPECTED_ENDPOINTS) {
      const found = weblensResources.some((resource) =>
        resource.resource.includes(endpoint)
      );

      if (found) {
        foundEndpoints.push(endpoint);
      } else {
        missingEndpoints.push(endpoint);
      }
    }

    // Display results
    console.log("📋 Endpoint Verification:\n");

    if (foundEndpoints.length > 0) {
      console.log("✅ Found in Bazaar:");
      foundEndpoints.forEach((endpoint) => {
        console.log(`   ✓ ${endpoint}`);
      });
      console.log();
    }

    if (missingEndpoints.length > 0) {
      console.log("❌ Missing from Bazaar:");
      missingEndpoints.forEach((endpoint) => {
        console.log(`   ✗ ${endpoint}`);
      });
      console.log();
    }

    // Display details for found resources
    console.log("📝 Resource Details:\n");
    weblensResources.forEach((resource, index) => {
      console.log(`${index + 1}. ${resource.resource}`);
      console.log(`   Network: ${resource.network}`);
      console.log(`   Price: ${resource.maxAmountRequired} (atomic units)`);
      console.log(`   Recipient: ${resource.payTo}`);
      console.log(`   Has Input Schema: ${resource.inputSchema ? "✅" : "❌"}`);
      console.log(`   Has Output Schema: ${resource.outputSchema ? "✅" : "❌"}`);
      console.log(`   Description: ${resource.metadata?.description || "N/A"}`);
      console.log();
    });

    // Summary
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📊 Summary:");
    console.log(`   Total expected: ${EXPECTED_ENDPOINTS.length}`);
    console.log(`   Found: ${foundEndpoints.length}`);
    console.log(`   Missing: ${missingEndpoints.length}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    if (missingEndpoints.length === 0) {
      console.log("🎉 All endpoints are properly listed in Bazaar!");
      process.exit(0);
    } else {
      console.log("⚠️  Some endpoints are missing. Check your configuration.");
      process.exit(1);
    }

  } catch (error) {
    console.error("❌ Error checking Bazaar:", error);
    process.exit(1);
  }
}

// Run the verification
verifyBazaarListing();
