# x402 Payment Protocol Integration Guide

This steering file contains essential knowledge for implementing x402 payments in WebLens.

## Overview

x402 is an open payment protocol built around the HTTP 402 status code. It enables services to charge for API access using crypto payments without accounts, sessions, or credential management.

**Key Benefits:**
- No fees (protocol has 0 fees)
- Instant settlement (~1-2 seconds)
- Blockchain agnostic (Base, Solana, Polygon, etc.)
- Frictionless (1 line of middleware code)
- Web native (uses standard HTTP 402 status code)

## Key Concepts

### Payment Flow
1. Client requests a resource
2. Server responds with `402 Payment Required` + payment instructions
3. Client signs and submits payment payload in `X-PAYMENT` header
4. Server verifies via facilitator's `/verify` endpoint
5. Server processes request and settles via `/settle` endpoint
6. Server returns response with `X-PAYMENT-RESPONSE` header

### Facilitators

Facilitators verify and settle payments on behalf of servers. Available facilitators:

| Facilitator | URL | Networks | Production Ready |
|-------------|-----|----------|------------------|
| x402.org | `https://x402.org/facilitator` | base-sepolia, solana-devnet | ❌ Testnet only |
| CDP | Use `facilitator` object from `@coinbase/x402` | base, base-sepolia, solana, solana-devnet | ✅ Requires CDP API keys |
| PayAI | `https://facilitator.payai.network` | solana, base, polygon, avalanche, sei, peaq, iotex + testnets | ✅ |
| x402.rs | `https://facilitator.x402.rs` | base-sepolia, base, xdc | ✅ |

## x402-hono Middleware Usage

```typescript
import { paymentMiddleware } from "x402-hono";

app.use(
  "/endpoint",
  paymentMiddleware(
    "0xYourWalletAddress",  // Receiving wallet
    {
      "/endpoint": {
        price: "$0.01",      // Price string for USDC
        network: "base-sepolia",
        config: {
          description: "Endpoint description",
          discoverable: true,  // For Bazaar discovery
        },
      },
    },
    { url: "https://x402.org/facilitator" }  // Facilitator URL
  )
);
```

## Price Configuration

- Use price strings like `"$0.01"` for USDC (default token)
- For custom EIP-3009 tokens, use `TokenAmount` with token address and EIP-712 info
- USDC is supported by default on all networks

## Multi-Chain Support

To support multiple networks, configure routes with different network values. The 402 response `accepts` array will contain payment options for each configured network.

### Network Mappings for WebLens
- `base`, `base-sepolia` → CDP facilitator (`https://x402.org/facilitator` for testnet)
- `solana`, `polygon`, `avalanche` → PayAI facilitator (`https://facilitator.payai.network`)

## Token Support

- **EVM Networks**: Any ERC-20 token implementing EIP-3009 (`transferWithAuthorization`)
- **Solana**: Any SPL or Token-2022 token
- **Default**: USDC on all networks

## Response Headers

- `X-PAYMENT-RESPONSE`: Base64-encoded JSON with settlement details (txHash, networkId)
- Standard headers: `X-Request-Id`, `X-Processing-Time`

## Error Handling

When payment fails, return 402 with updated payment requirements:
```json
{
  "error": "Payment verification failed",
  "accepts": [...],
  "x402Version": 1
}
```

## Pricing Strategies

Common pricing patterns:
- **Flat per-call**: `$0.001` per request
- **Tiered**: `/basic` vs `/pro` endpoints with different prices
- **Up-to** (future): Pay based on actual usage (tokens, MB, etc.)

## AI Agent Support

Agents follow the same flow as humans:
1. Make a request
2. Parse the 402 JSON (`accepts` array)
3. Choose a suitable requirement and sign payload via x402 client SDKs
4. Retry with `X-PAYMENT` header

Agents need programmatic wallets (CDP Wallet API, viem, ethers HD wallets) to sign EIP-712 payloads.

## Troubleshooting

Common issues:
- **402 after attaching X-PAYMENT**: Check signature validity, payment amount >= maxAmountRequired, sufficient USDC balance
- **Testnet works but mainnet fails**: Ensure `network: "base"` (not "base-sepolia"), wallet has mainnet USDC

## Documentation References

- Main docs: https://x402.gitbook.io/x402
- GitHub: https://github.com/coinbase/x402
- Seller quickstart: https://x402.gitbook.io/x402/getting-started/quickstart-for-sellers
- Network support: https://x402.gitbook.io/x402/core-concepts/network-and-token-support
- FAQ: https://x402.gitbook.io/x402/faq
- MCP Integration: https://x402.gitbook.io/x402/guides/mcp-server-with-x402
