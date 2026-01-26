/**
 * Discovery Script - List x402 Resources from Bazaar
 * Uses x402 v2 API to discover available paid endpoints
 */

import { HTTPFacilitatorClient } from "@x402/core/http";
import { withBazaar } from "@x402/extensions/bazaar";

// Create facilitator client with Bazaar extension
const facilitatorClient = withBazaar(
  new HTTPFacilitatorClient({
    url: "https://api.cdp.coinbase.com/platform/v2/x402"
  })
);

// Query available services
facilitatorClient.extensions.discovery.listResources({
  type: "http",
  limit: 50,
}).then(response => {
    console.log("\nDiscovered X402 Resources:");
    console.log("========================\n");

    response.items.forEach((item, index) => {
        console.log(`Resource ${index + 1}:`);
        console.log(`  Resource URL: ${item.resource}`);
        console.log(`  Type: ${item.type}`);
        console.log(`  Last Updated: ${new Date(item.lastUpdated).toLocaleString()}`);
        console.log(`  X402 Version: ${item.x402Version}`);
        console.log(`  Accepts: ${JSON.stringify(item.accepts, null, 2)}`);
        if (item.metadata && Object.keys(item.metadata).length > 0) {
            console.log(`  Metadata: ${JSON.stringify(item.metadata, null, 2)}`);
        }
        console.log("------------------------\n");
    });
    
    console.log(`\nTotal resources found: ${response.items.length}`);
}).catch(error => {
    console.error("Error discovering resources:", error.message);
    process.exit(1);
});