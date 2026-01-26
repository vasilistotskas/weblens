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

## x402 v2 Hono Middleware Usage with Bazaar

**IMPORTANT: WebLens now uses x402 v2 API with `@x402/hono`, `@x402/core`, `@x402/evm`, and `@x402/extensions` packages.**

```typescript
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { paymentMiddleware } from "@x402/hono";

// Create facilitator client
const facilitatorClient = new HTTPFacilitatorClient({
  url: "https://x402.org/facilitator"  // For testnet
  // OR for mainnet with CDP:
  // url: "https://api.cdp.coinbase.com/platform/v2/x402"
});

// Create resource server, register EVM scheme AND Bazaar extension
const NETWORK_CAIP2 = "eip155:84532"; // Base Sepolia
// OR "eip155:8453" for Base mainnet
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(NETWORK_CAIP2, new ExactEvmScheme())
  .registerExtension(bazaarResourceServerExtension);  // REQUIRED for Bazaar listing

// Apply middleware with discovery metadata
app.use(
  "/endpoint",
  paymentMiddleware(
    {
      "/endpoint": {
        accepts: [{
          scheme: "exact",
          price: "$0.01",
          network: NETWORK_CAIP2,
          payTo: "0xYourWalletAddress",
        }],
        description: "Endpoint description",
        mimeType: "application/json",
        // Add Bazaar discovery extension for automatic cataloging
        extensions: {
          ...declareDiscoveryExtension({
            input: {
              // Input schema for discovery
              bodyType: "json",
              bodyFields: {
                url: { type: "string", required: true },
              },
            },
            output: {
              // Output schema for discovery
              schema: {
                properties: {
                  result: { type: "string" },
                },
              },
            },
          }),
        },
      },
    },
    resourceServer
  )
);
```

### v1 to v2 Migration Notes

**Package Changes:**
- Replace `x402-hono` with `@x402/hono`
- Add `@x402/core` and `@x402/evm` packages
- Add `@x402/extensions` for Bazaar support
- `@coinbase/x402` v2.1.0+ is compatible with v2 packages

**API Changes:**
- Use `HTTPFacilitatorClient` instead of facilitator URL objects
- Use `x402ResourceServer` and register schemes explicitly
- Use CAIP-2 network format (`eip155:8453` instead of `base`)
- Middleware config structure changed: `accepts` array with `scheme`, `price`, `network`, `payTo`
- No more `config.discoverable` - all endpoints are discoverable by default

**Bazaar Integration (REQUIRED for listing):**
- Register `bazaarResourceServerExtension` on resource server
- Use `declareDiscoveryExtension()` in route configurations
- Include input/output schemas for better discovery
- Facilitator automatically catalogs services when processing payments

## Bazaar Discovery Extension

To get listed in the Coinbase Bazaar (REQUIRED for AI agent discovery):

1. **Register the extension on your resource server:**
```typescript
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";

const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(NETWORK_CAIP2, new ExactEvmScheme())
  .registerExtension(bazaarResourceServerExtension);
```

2. **Declare discovery metadata in route configs:**
```typescript
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

{
  "/endpoint": {
    accepts: [...],
    description: "Clear description of what your endpoint does",
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        input: {
          bodyType: "json",
          bodyFields: {
            url: { type: "string", description: "URL to fetch", required: true },
          },
        },
        output: {
          example: {
            content: "Sample content...",
            title: "Sample Title",
          },
          schema: {
            properties: {
              content: { type: "string" },
              title: { type: "string" },
            },
          },
        },
      }),
    },
  },
}
```

**IMPORTANT:** The `output` field should include BOTH `example` and `schema`:
- `example`: Realistic sample response demonstrating your API's format
- `schema`: JSON Schema defining the response structure

**How it works:**
- Facilitator extracts discovery metadata when processing payments
- Services are automatically cataloged in the Bazaar
- AI agents can query `/discovery/resources` to find your service
- No manual registration needed - happens automatically with first payment

## Price Configuration

- Use price strings like `"$0.01"` for USDC (default token)
- For custom EIP-3009 tokens, use `TokenAmount` with token address and EIP-712 info
- USDC is supported by default on all networks

## Multi-Chain Support

To support multiple networks, configure routes with different network values. The 402 response `accepts` array will contain payment options for each configured network.

### Network Mappings for WebLens (v2 CAIP-2 Format)
- `eip155:8453` (Base mainnet) → CDP facilitator with API keys
- `eip155:84532` (Base Sepolia testnet) → `https://x402.org/facilitator`
- `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (Solana mainnet) → PayAI facilitator
- `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` (Solana Devnet) → `https://x402.org/facilitator`

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

## Cloudflare Workers Specific Configuration

**CRITICAL: Cloudflare Workers cannot call `fetch()` during module initialization (global scope).**

The `paymentMiddleware` from `@x402/hono` validates routes at module load time by calling the facilitator's `/supported` endpoint, which uses `fetch()`. This is explicitly forbidden in Cloudflare Workers.

### Solution: Lazy Initialization Pattern

```typescript
// Create lazy initialization function
let resourceServer: x402ResourceServer | null = null;

function getResourceServer(): x402ResourceServer {
  if (resourceServer) {
    return resourceServer;
  }

  console.log("🔧 [First Request] Initializing x402 resource server...");

  const facilitatorClient = new HTTPFacilitatorClient({
    url: "https://x402.org/facilitator"
  });

  resourceServer = new x402ResourceServer(facilitatorClient);
  resourceServer.register(NETWORK_CAIP2, new ExactEvmScheme());
  resourceServer.registerExtension(bazaarResourceServerExtension);

  return resourceServer;
}

// Create lazy payment middleware wrapper
function createLazyPaymentMiddleware(
  path: string,
  price: string,
  description: string,
  inputSchema?: any,
  outputExample?: any,
  outputSchema?: any
) {
  let middleware: ReturnType<typeof paymentMiddleware> | null = null;

  return async (c: any, next: any) => {
    if (!middleware) {
      const config = createPaymentConfig(path, price, description, inputSchema, outputExample, outputSchema);
      const server = getResourceServer();
      middleware = paymentMiddleware(config, server);
    }
    return middleware(c, next);
  };
}

// Use lazy middleware for all endpoints
app.use("/endpoint", createLazyPaymentMiddleware(
  "/endpoint",
  "$0.01",
  "Description",
  inputSchema,
  outputExample,
  outputSchema
));
```

### Key Points:
- Resource server initialization is deferred until first request
- Each endpoint's middleware is initialized on its first request
- No `fetch()` calls happen during module load
- Works perfectly with Cloudflare Workers deployment

## Troubleshooting

Common issues:
- **402 after attaching X-PAYMENT**: Check signature validity, payment amount >= maxAmountRequired, sufficient USDC balance
- **Testnet works but mainnet fails**: Ensure `network: "base"` (not "base-sepolia"), wallet has mainnet USDC
- **Not listed in Bazaar**: Ensure `bazaarResourceServerExtension` is registered and `declareDiscoveryExtension()` is used in routes
- **500 errors on Cloudflare Workers**: Use lazy initialization pattern to avoid `fetch()` in global scope
- **Empty 402 response body**: This is expected in v2 - payment requirements are in `PAYMENT-REQUIRED` header

## Documentation References

- Main docs: https://x402.gitbook.io/x402
- GitHub: https://github.com/coinbase/x402
- Seller quickstart: https://x402.gitbook.io/x402/getting-started/quickstart-for-sellers
- Network support: https://x402.gitbook.io/x402/core-concepts/network-and-token-support
- FAQ: https://x402.gitbook.io/x402/faq
- MCP Integration: https://x402.gitbook.io/x402/guides/mcp-server-with-x402
- Bazaar Discovery: https://docs.cdp.coinbase.com/x402/bazaar
