# WebLens

Premium Web Intelligence API with x402 micropayments.

## Features

- **`/fetch`** - Fetch any webpage and convert to clean markdown ($0.01)
- **`/search`** - Real-time web search results ($0.005)
- **`/extract`** - AI-powered structured data extraction ($0.02)

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
| `NETWORK` | `base-sepolia` (testnet) or `base` (mainnet) |
| `ANTHROPIC_API_KEY` | Optional: For AI extraction |

## License

MIT
