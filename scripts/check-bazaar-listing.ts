/**
 * Check if WebLens is listed in the Coinbase Bazaar
 * 
 * This script queries the CDP facilitator's discovery endpoint to see if
 * WebLens endpoints are cataloged and discoverable by AI agents.
 * 
 * Run: npx tsx scripts/check-bazaar-listing.ts
 */

import axios from "axios";

const CDP_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";
const WEBLENS_DOMAIN = "api.weblens.dev";

interface DiscoveryResource {
    resource: string;
    type: string;
    x402Version: number;
    accepts: unknown[];
    lastUpdated: string;
    metadata?: {
        description?: string;
        input?: unknown;
        output?: unknown;
    };
}

interface DiscoveryResponse {
    x402Version: number;
    items: DiscoveryResource[];
    pagination: {
        limit: number;
        offset: number;
        total: number;
    };
}

async function queryBazaar(limit = 100, offset = 0): Promise<DiscoveryResponse> {
    try {
        const response = await axios.get(`${CDP_FACILITATOR_URL}/discovery/resources`, {
            params: {
                type: "http",
                limit,
                offset,
            },
        });
        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.error("❌ Failed to query Bazaar:", error.message);
            if (error.response) {
                console.error("   Status:", error.response.status);
                console.error("   Data:", JSON.stringify(error.response.data, null, 2));
            }
        }
        throw error;
    }
}

async function main() {
    console.log("🔍 Checking WebLens listing in Coinbase Bazaar");
    console.log("=".repeat(50));
    console.log(`Facilitator: ${CDP_FACILITATOR_URL}`);
    console.log(`Looking for: ${WEBLENS_DOMAIN}\n`);

    try {
        // Query the discovery endpoint
        const discovery = await queryBazaar();

        console.log(`📊 Total resources in Bazaar: ${discovery.pagination.total}`);
        console.log(`   Showing: ${discovery.items.length} resources\n`);

        // Filter for WebLens endpoints
        const weblensEndpoints = discovery.items.filter((item) =>
            item.resource.includes(WEBLENS_DOMAIN)
        );

        if (weblensEndpoints.length === 0) {
            console.log("❌ WebLens is NOT listed in the Bazaar yet");
            console.log("\n💡 To get listed:");
            console.log("   1. Make sure you're using the CDP facilitator (production)");
            console.log("   2. Have someone make a successful payment to any endpoint");
            console.log("   3. The facilitator will automatically catalog the endpoint");
            console.log("   4. Run this script again to verify\n");

            // Show a sample of what's in the Bazaar
            if (discovery.items.length > 0) {
                console.log("📋 Sample of other services in Bazaar:");
                discovery.items.slice(0, 5).forEach((item, i) => {
                    console.log(`   ${i + 1}. ${item.resource}`);
                    if (item.metadata?.description) {
                        console.log(`      ${item.metadata.description}`);
                    }
                });
            }
        } else {
            console.log(`✅ WebLens IS listed in the Bazaar!`);
            console.log(`   Found ${weblensEndpoints.length} endpoint(s):\n`);

            weblensEndpoints.forEach((endpoint, i) => {
                console.log(`${i + 1}. ${endpoint.resource}`);
                console.log(`   Description: ${endpoint.metadata?.description || "N/A"}`);
                console.log(`   Last Updated: ${endpoint.lastUpdated}`);
                console.log(`   x402 Version: ${endpoint.x402Version}`);
                console.log(`   Payment Networks: ${endpoint.accepts.length}`);
                console.log();
            });

            console.log("🎉 Your endpoints are discoverable by AI agents!");
        }
    } catch (error) {
        console.error("\n❌ Error checking Bazaar listing");
        if (error instanceof Error) {
            console.error("   ", error.message);
        }
        process.exit(1);
    }
}

main();
