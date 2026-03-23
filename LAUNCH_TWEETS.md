# WebLens Launch Tweet Thread

## Tweet 1 (Hook)

Just shipped WebLens — a web intelligence API where AI agents pay per request with USDC. No accounts, no API keys.

Try it now:
curl https://api.weblens.dev/r/https://example.com

Returns any webpage as clean markdown. Free. One GET request.

Thread on how it works:

## Tweet 2 (The Problem)

AI agents need web data constantly — scraping pages, searching the web, extracting structured data.

But current APIs require:
- Account signup
- API key management
- Monthly subscriptions
- Billing dashboards

None of this works for autonomous agents.

## Tweet 3 (The Solution)

WebLens uses the x402 protocol by @CoinbaseDev.

Your agent sends a request, gets a 402 with a price tag, signs a USDC transfer on Base, retries. Done in ~2 seconds.

Your wallet is your identity. No signup. No keys. Just pay and get data.

## Tweet 4 (What You Can Do)

15+ endpoints:
- Web scraping (static + JS) — $0.005-$0.015
- Screenshots — $0.02
- Web search — $0.005
- AI data extraction — $0.03
- Research (search + fetch + AI summary) — $0.08
- PDF parsing — $0.01
- Batch fetch — $0.003/URL
- URL monitoring — $0.01

70% cache discount on everything.

## Tweet 5 (Zero Friction Reader)

The killer feature: GET /r/{any-url}

No POST body. No headers. No auth. Just append a URL and get markdown back.

https://api.weblens.dev/r/https://news.ycombinator.com

Free tier: 10/hr, 2000 chars. Upgrade to paid for full content.

Think Jina Reader, but with x402 payment upgrade path.

## Tweet 6 (For Agent Builders)

Built-in MCP server at /mcp — 10 tools ready for Claude, Cursor, or any MCP-compatible agent.

Discovery at /.well-known/x402 for Bazaar indexing.
OpenAPI spec at /openapi.json.
LLM-optimized guide at /llms.txt.

Your agent can discover and use WebLens autonomously.

## Tweet 7 (Tech Stack)

Built on:
- @CloudflareDev Workers (edge compute)
- Hono framework
- @x402 protocol (micropayments)
- @CoinbaseDev CDP (payment verification)
- Base network (USDC settlement)

Entire API runs serverless at the edge. Sub-second cold starts.

## Tweet 8 (CTA)

Try it:
curl https://api.weblens.dev/r/https://example.com

Docs: https://api.weblens.dev/docs
MCP: https://api.weblens.dev/mcp

Built for the agentic economy. Your AI agents deserve web superpowers.

#x402 #MCP #AIAgents #Base #USDC #CloudflareWorkers
