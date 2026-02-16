# WebLens

Premium Web Intelligence API with x402 micropayments. Give your AI agents web superpowers.

🌐 **Live API:** https://api.weblens.dev  
📖 **Docs:** https://api.weblens.dev/docs

## Features

| Endpoint | Description | Price |
|----------|-------------|-------|
| `/fetch/basic` | Fetch webpage as markdown | $0.005 |
| `/fetch/pro` | Fetch with JavaScript rendering | $0.015 |
| `/screenshot` | Capture webpage screenshot | $0.02 |
| `/search` | Real-time web search | $0.005 |
| `/extract` | Structured data extraction | $0.03 |
| `/extract/smart` | AI-powered extraction | $0.035 |
| `/research` | Search + fetch + summarize | $0.08 |
| `/pdf` | Extract text from PDFs | $0.01 |
| `/compare` | Compare 2-3 webpages | $0.05 |
| `/batch/fetch` | Fetch multiple URLs | $0.003/URL |

## Use with AI Agents (MCP)

**Option 1: Remote HTTP (no install needed)**
```json
{
  "mcpServers": {
    "weblens": {
      "url": "https://api.weblens.dev/mcp"
    }
  }
}
```

**Option 2: Local with auto-payment**
```json
{
  "mcpServers": {
    "weblens": {
      "command": "npx",
      "args": ["-y", "weblens-mcp"],
      "env": {
        "PRIVATE_KEY": "0xYourPrivateKeyHere"
      }
    }
  }
}
```

See [mcp-server/README.md](./mcp-server/README.md) for full setup instructions.

## Quick Start

```bash
# Install dependencies
npm install

# Set your wallet address
cp .env.example .env
# Edit .env with your wallet address

# Run locally
npm run dev

# Deploy to Cloudflare Workers
npm run deploy
```

## API Usage

### Fetch Page

```bash
curl -X POST http://localhost:8787/fetch \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

### Search Web

```bash
curl -X POST http://localhost:8787/search \
  -H "Content-Type: application/json" \
  -d '{"query": "latest AI news", "limit": 5}'
```

### Extract Data

```bash
curl -X POST http://localhost:8787/extract \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/product",
    "schema": {"price": "string", "title": "string"},
    "instructions": "Extract the product price and title"
  }'
```

## Payment Flow

1. Client makes request without payment
2. Server responds with `402 Payment Required` + payment details
3. Client signs payment with their wallet
4. Client retries request with `X-PAYMENT` header
5. Server verifies payment and returns data

## Tech Stack

- **Hono** - Ultrafast web framework
- **x402** - Payment protocol
- **Cloudflare Workers** - Edge deployment
- **Zod** - Schema validation

## Configuration

| Variable | Description |
|----------|-------------|
| `WALLET_ADDRESS` | Your wallet to receive payments |
| `CDP_API_KEY_ID` | CDP API key for Bazaar discovery |
| `CDP_API_KEY_SECRET` | CDP API secret |
| `ANTHROPIC_API_KEY` | Optional: For AI extraction |

## How Payments Work

WebLens uses the [x402 protocol](https://x402.org) for instant micropayments:

1. Request any endpoint
2. Get `402 Payment Required` with price
3. Sign USDC payment with your wallet
4. Retry with `X-PAYMENT` header
5. Get your data (payment settles in ~1-2 seconds)

No accounts. No API keys. No subscriptions. Just pay per use.

## Links

- [API Documentation](https://api.weblens.dev/docs)
- [x402 Protocol](https://x402.org)
- [Bazaar Discovery](https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources)

## License

MIT


## Testing & Validation

### Run Unit Tests
```bash
npm test
```

### Validate Bazaar Discovery Configuration
Check if all endpoints are properly configured for Coinbase Bazaar discovery:
```bash
npx tsx scripts/validate-bazaar.ts
```

This validates:
- ✅ Bazaar extension structure
- ✅ JSON Schema validity
- ✅ Input/output examples
- ✅ HTTP method declarations

### Check Bazaar Listing Status
See if WebLens is listed in the Coinbase Bazaar:
```bash
npx tsx scripts/check-bazaar-listing.ts
```

**Note:** Endpoints are automatically cataloged by the CDP facilitator when the first payment is processed. To get listed, someone needs to make a successful payment.

### Test Payments (Production)
Test with real USDC on Base mainnet:
```bash
$env:PRIVATE_KEY='0x...'  # Your wallet private key
npx tsx scripts/test-payment.ts
```

**Requirements:**
- Wallet must have USDC on Base mainnet
- USDC contract: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Estimated cost: ~$0.20 USDC for all endpoints

### Test Payments (Testnet)
Test with fake USDC on Base Sepolia testnet:
```bash
# Terminal 1: Start local testnet server
npx wrangler dev --env testnet

# Terminal 2: Run tests
$env:API_URL='http://localhost:8787'
$env:PRIVATE_KEY='0x...'
npx tsx scripts/test-payment-testnet.ts
```

**Get testnet USDC:**
- Faucet: https://faucet.circle.com/
- Network: Base Sepolia
- Free fake USDC for testing

## Bazaar Discovery

WebLens is configured for automatic discovery in the [Coinbase Bazaar](https://docs.cdp.coinbase.com/x402/bazaar), making it discoverable by AI agents.

**How it works:**
1. All endpoints include Bazaar discovery metadata
2. CDP facilitator extracts metadata when processing payments
3. Endpoints are automatically cataloged in the Bazaar
4. AI agents can query `/discovery/resources` to find WebLens

**Discovery metadata includes:**
- Input schema (request parameters)
- Output schema (response format)
- Example requests and responses
- Pricing information
- Network support

Run `npx tsx scripts/validate-bazaar.ts` to verify your configuration.
