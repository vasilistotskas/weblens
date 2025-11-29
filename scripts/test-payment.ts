/**
 * Test script for x402 payments on WebLens
 * 
 * Prerequisites:
 * 1. Get testnet USDC from https://faucet.circle.com/ (Base Sepolia)
 * 2. Export your wallet private key from Coinbase Wallet
 * 3. Run: npx ts-node scripts/test-payment.ts
 */

import { createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { wrapFetch } from "@coinbase/x402";

// ⚠️ Replace with your private key (NEVER commit this!)
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;

if (!PRIVATE_KEY) {
  console.error("Set PRIVATE_KEY environment variable");
  console.log("Example: $env:PRIVATE_KEY='0x...' ; npx ts-node scripts/test-payment.ts");
  process.exit(1);
}

const API_URL = "https://api.weblens.dev";

async function main() {
  // Create wallet client
  const account = privateKeyToAccount(PRIVATE_KEY);
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(),
  });

  console.log(`Using wallet: ${account.address}`);
  console.log(`Testing API: ${API_URL}`);

  // Wrap fetch with x402 payment handling
  const x402Fetch = wrapFetch(fetch, walletClient);

  try {
    // Test /fetch/basic endpoint
    console.log("\n--- Testing /fetch/basic ---");
    const response = await x402Fetch(`${API_URL}/fetch/basic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });

    if (response.ok) {
      const data = await response.json();
      console.log("✅ Success! Response:", JSON.stringify(data, null, 2).slice(0, 500));
      
      // Check payment response header
      const paymentResponse = response.headers.get("X-PAYMENT-RESPONSE");
      if (paymentResponse) {
        const decoded = JSON.parse(atob(paymentResponse));
        console.log("\n💰 Payment settled:", decoded);
      }
    } else {
      console.log("❌ Failed:", response.status, await response.text());
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
