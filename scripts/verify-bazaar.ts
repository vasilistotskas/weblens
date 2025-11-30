/**
 * Verify WebLens Bazaar Listing
 *
 * This script checks if WebLens endpoints are properly listed in the
 * Coinbase Bazaar discovery catalog.
 *
 * Usage:
 *   npx ts-node scripts/verify-bazaar.ts
 */

interface BazaarAccept {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description?: string;
  mimeType?: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  asset: string;
  outputSchema?: unknown;
  extra?: {
    name?: string;
    version?: string;
  };
}

interface BazaarItem {
  resource: string;
  type: string;
  x402Version: number;
  accepts: BazaarAccept[];
  metadata?: Record<string, unknown>;
  lastUpdated?: string;
}

interface BazaarResponse {
  items?: BazaarItem[];
  resources?: BazaarItem[];
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

    // Debug: log the actual response structure
    console.log(`✅ Successfully fetched Bazaar catalog`);
    console.log(`📊 Response keys: ${Object.keys(data).join(", ")}`);
    
    // Handle both 'items' and 'resources' keys
    const allResources = data.items || data.resources || [];
    console.log(`📊 Total resources in Bazaar: ${allResources.length}\n`);

    // Filter for WebLens resources (containing "weblens" or our wallet)
    const weblensResources = allResources.filter((item) => {
      const resourceUrl = item.resource || item.accepts?.[0]?.resource || "";
      return resourceUrl.includes("weblens") || resourceUrl.includes("api.weblens.dev");
    });

    if (weblensResources.length === 0) {
      console.log("❌ No WebLens resources found in Bazaar!");
      
      // Show sample of what IS in the Bazaar
      console.log("\n📋 Sample resources in Bazaar (first 5):");
      allResources.slice(0, 5).forEach((item, index) => {
        const accept = item.accepts?.[0];
        console.log(`   ${index + 1}. ${item.resource || accept?.resource || "N/A"}`);
      });
      
      console.log("\n🔧 Troubleshooting:");
      console.log("   1. Ensure you're using the CDP facilitator from @coinbase/x402");
      console.log("   2. Verify CDP_API_KEY_ID and CDP_API_KEY_SECRET are set");
      console.log("   3. Check that discoverable: true is set on all endpoints");
      console.log("   4. Deploy your changes: npm run deploy");
      console.log("   5. Wait 5-10 minutes for Bazaar indexing");
      console.log("   6. The CDP facilitator must successfully verify at least one payment");
      console.log("      for the service to be indexed in Bazaar");
      process.exit(1);
    }

    console.log(`✅ Found ${weblensResources.length} WebLens resources in Bazaar!\n`);

    // Check each expected endpoint
    const foundEndpoints: string[] = [];
    const missingEndpoints: string[] = [];

    for (const endpoint of EXPECTED_ENDPOINTS) {
      const found = weblensResources.some((item) => {
        const resourceUrl = item.resource || item.accepts?.[0]?.resource || "";
        return resourceUrl.includes(endpoint);
      });

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
    weblensResources.forEach((item, index) => {
      const accept = item.accepts?.[0];
      const resourceUrl = item.resource || accept?.resource || "N/A";
      console.log(`${index + 1}. ${resourceUrl}`);
      console.log(`   Network: ${accept?.network || "N/A"}`);
      console.log(`   Price: ${accept?.maxAmountRequired || "N/A"} (atomic units)`);
      console.log(`   Recipient: ${accept?.payTo || "N/A"}`);
      console.log(`   Asset: ${accept?.asset || "N/A"}`);
      console.log(`   Has Output Schema: ${accept?.outputSchema ? "✅" : "❌"}`);
      console.log(`   Description: ${accept?.description || "N/A"}`);
      console.log(`   Extra (EIP-712): ${accept?.extra ? JSON.stringify(accept.extra) : "N/A"}`);
      console.log(`   Last Updated: ${item.lastUpdated || "N/A"}`);
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
