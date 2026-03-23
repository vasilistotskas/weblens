# Show HN: WebLens – Web intelligence API for AI agents, pay-per-request with USDC

Hey HN, I built WebLens — a web intelligence API designed for AI agents that uses the x402 micropayment protocol. No accounts, no API keys, no subscriptions. Just pay per request with USDC on Base.

**Try it right now** (no setup needed):

```
curl https://api.weblens.dev/r/https://news.ycombinator.com
```

That's the zero-friction reader endpoint — returns any webpage as clean markdown via a simple GET request. Free tier: 10 requests/hour, 2000 char limit.

## What it does

15+ endpoints for AI agents that need web data:

- **Web scraping** — static and JS-rendered pages ($0.005-$0.015)
- **Screenshots** — full-page PNG capture ($0.02)
- **Search** — real-time web search ($0.005)
- **Data extraction** — CSS selectors or natural language ($0.03-$0.035)
- **AI research** — search + fetch + AI summary in one call ($0.08)
- **PDF extraction** — text and metadata ($0.01)
- **Batch fetch** — parallel multi-URL ($0.003/URL)
- **URL monitoring** — change detection with webhooks ($0.01)
- **Persistent memory** — key-value storage for agents ($0.001)

70% discount on cached responses.

## How payment works

The x402 protocol (https://x402.org) uses HTTP 402 Payment Required:

1. POST to any endpoint → get 402 with payment instructions
2. Sign a USDC transfer on Base
3. Retry with payment header → get your data

The whole flow takes ~2 seconds. No account creation, no API key management. Your wallet IS your identity.

There's also a credit system — pre-fund a wallet for bulk usage with bonus tiers (20-40% extra credits).

## Tech stack

- Cloudflare Workers + Hono framework
- @x402/hono middleware for payment verification
- Coinbase CDP facilitator for settlement
- MCP endpoint for AI agent tool discovery
- Bazaar discovery extensions

## Why I built this

I wanted AI agents to be able to access web data without the friction of API key management and billing accounts. The x402 protocol makes this possible — an agent with a funded wallet can discover and pay for services autonomously.

The free reader endpoint (`GET /r/{url}`) exists so developers can try it instantly before deciding if the paid endpoints are worth it.

## Links

- Live API: https://api.weblens.dev
- Interactive docs: https://api.weblens.dev/docs
- Free reader: https://api.weblens.dev/r/https://example.com
- OpenAPI spec: https://api.weblens.dev/openapi.json
- MCP endpoint: https://api.weblens.dev/mcp
- LLM guide: https://api.weblens.dev/llms.txt

Happy to answer questions about x402, Cloudflare Workers, or the architecture.
