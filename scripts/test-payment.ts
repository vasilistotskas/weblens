/**
 * Test script for x402 payments on WebLens
 *
 * Prerequisites:
 * 1. Get testnet USDC from https://faucet.circle.com/ (Base Sepolia)
 * 2. Export your wallet private key
 * 3. Run: $env:PRIVATE_KEY='0x...' ; npx ts-node scripts/test-payment.ts
 */

import axios from "axios";
import { privateKeyToAccount } from "viem/accounts";
import { withPaymentInterceptor } from "x402-axios";
import type { Hex } from "viem";

const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex;

if (!PRIVATE_KEY) {
  console.error("❌ Set PRIVATE_KEY environment variable");
  console.log("Example: $env:PRIVATE_KEY='0x...' ; npx ts-node scripts/test-payment.ts");
  process.exit(1);
}

const API_URL = "https://api.weblens.dev";

async function main() {
  // Create wallet account
  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log(`🔑 Using wallet: ${account.address}`);
  console.log(`🌐 Testing API: ${API_URL}`);

  // Create axios client with x402 payment interceptor
  const client = withPaymentInterceptor(axios.create({ baseURL: API_URL }), account);

  try {
    // Test /fetch/basic endpoint
    console.log("\n--- Testing POST /fetch/basic ---");
    const response = await client.post("/fetch/basic", {
      url: "https://example.com",
    });

    console.log("✅ Success!");
    console.log("Status:", response.status);
    console.log("Title:", response.data.title);
    console.log("Content preview:", response.data.content?.slice(0, 200) + "...");

    // Check payment response header
    const paymentResponse = response.headers["x-payment-response"];
    if (paymentResponse) {
      const decoded = JSON.parse(Buffer.from(paymentResponse, "base64").toString());
      console.log("\n💰 Payment settled:", decoded);
    }
  } catch (error: any) {
    if (error.response) {
      console.log("❌ Error:", error.response.status, error.response.data);
    } else {
      console.error("❌ Error:", error.message);
    }
  }
}

main();
