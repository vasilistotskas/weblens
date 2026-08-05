# WebLens

Premium web intelligence API for AI agents, with x402 micropayments. No accounts, no API keys — pay per request in USDC on Base.

🌐 **Live API:** https://api.weblens.dev
📖 **Interactive docs:** https://api.weblens.dev/docs
🤖 **Agent guide:** https://api.weblens.dev/llms.txt
🔎 **Marketplace:** [listed on x402scan](https://www.x402scan.com/server/529d8bbf-63d0-481c-93b2-21a92e2060d8)

## Try it free, right now

No wallet, no signup — these are rate limited to 10 requests/hour per IP:

```bash
curl https://api.weblens.dev/r/https://example.com     # any page as markdown
curl https://api.weblens.dev/s/cloudflare+workers      # web search
```

## Preview before you pay (free)

An agent shouldn't have to buy a call to learn what it returns. `POST /preview` is free and
answers that up front — the live price, a one-line summary, and a real sample of the exact
response shape:

```bash
curl -X POST https://api.weblens.dev/preview \
  -H "Content-Type: application/json" \
  -d '{"endpoint": "/answer"}'
```

```jsonc
{
  "endpoint": "/answer",
  "price": "$0.05",
  "currency": "USD",
  "summary": "A direct answer with inline [n] citations to real sources.",
  "sample": { "query": "...", "answer": "...", "citations": [], "confidence": 0.92 },
  "sampleType": "recorded",
  "livePreviewAvailable": false,
  "livePreviewHint": "This endpoint calls a paid upstream provider, so free live previews are not offered — the recorded sample shows the exact response shape."
}
```

**Live vs recorded.** A real, truncated live preview runs only for endpoints whose marginal cost
is a plain fetch — currently `/fetch/basic`, `/contents` and `/map` — and only when you pass a
`url`. Everything else is backed by a metered upstream (SerpAPI, Anthropic); running those free
would burn upstream credits, so they return the recorded sample, which still shows every field
name and type. An endpoint that isn't sold returns `404`.

```bash
# live: the first 500 chars of the real result, for free
curl -X POST https://api.weblens.dev/preview \
  -H "Content-Type: application/json" \
  -d '{"endpoint": "/fetch/basic", "url": "https://example.com"}'
```

Rate limited to 10 requests/hour per IP like the rest of the free tier.

## ERC-8004: receipts and feedback

ERC-8004 (Trustless Agents) keeps compact signals on-chain and the detailed documents off-chain.
WebLens hosts the **off-chain half** — the part a service operator can run without deploying a
contract. To be precise about what that is and isn't: **WebLens is not registered on-chain, holds
no agent id, and writes nothing to any registry.**

| Endpoint | What it gives you |
|----------|-------------------|
| `GET /.well-known/agent-registration.json` | The ERC-8004 registration document: name, description, image, services, `x402Support`, payment info, feedback endpoints. `registrations` is empty (no on-chain registration) and `supportedTrust` is `["feedback"]`. |
| `GET /receipts/{requestId}` | The receipt for a paid call — endpoint, status, outcome, price, payment method, network, pay-to. Every paid response returns `X-Receipt-Id` and `X-Receipt-Url` headers pointing here. Kept 30 days. |
| `POST /feedback` | Host a feedback document *you* author; returns `{feedbackURI, feedbackHash}` (keccak-256), the pair `giveFeedback()` expects. Required fields: `agentRegistry`, `agentId`, `clientAddress`, `createdAt`, `value`, `valueDecimals` — a missing one returns `400` naming it. |
| `GET /feedback/{id}` | Serves that document byte-for-byte, so its keccak-256 hash matches the `feedbackHash` you were given. This URL *is* the `feedbackURI`. |

Two more things worth stating plainly:

- A receipt's `mac` is a **symmetric HMAC tag** (the same construction as proof-of-context). Only a
  holder of the key can verify it — it is not a third-party-verifiable signature, and nothing here
  is trustless.
- The **buyer** authors the feedback document and posts `giveFeedback()` themselves. WebLens only
  hosts the document verbatim and returns its hash; it never authors, edits, or submits feedback.

## Endpoints

All paid endpoints are `POST` with a JSON body. Prices are per request in USDC.

### Core

| Endpoint | Description | Price |
|----------|-------------|-------|
| `/fetch/basic` | Fetch a webpage as clean markdown | $0.002 |
| `/fetch/pro` | Fetch with full JavaScript rendering (SPAs) | $0.006 |
| `/fetch/resilient` | Auto-fallback: native scraper → headless Chromium | $0.008 |
| `/contents` | Bulk page text for 1–20 URLs | $0.0015/URL |
| `/screenshot` | Capture a webpage screenshot (PNG) | $0.008 |
| `/batch/fetch` | Fetch 2–20 URLs in parallel | $0.0015/URL |
| `/map` | Discover a site's URLs (sitemaps + links, no page fetches) | $0.004 |
| `/domain` | Registration + DNS + SaaS stack + risk signals for a domain | $0.005 |
| `/tech` | Detect a site's framework, CMS, CDN, analytics and payments stack | $0.005 |
| `/package` | npm/PyPI package health: deprecation, downloads, maintenance | $0.003 |
| `/discussions` | Hacker News stories on a topic, with aggregates | $0.004 |
| `/intel/project` | Off-chain project due diligence: domain age, team/whitepaper, contract cross-check, A–F grade | $0.05 |
| `/crawl` | Bounded whole-site crawl → markdown per page | $0.0015/page |

### Search

| Endpoint | Description | Price |
|----------|-------------|-------|
| `/search` | Real-time web search (`includeContent` adds page markdown, +$0.0015/result) | $0.015 |
| `/search/news` | Google News articles with source and date | $0.015 |
| `/search/images` | Image results with dimensions and source pages | $0.015 |
| `/search/places` | Local businesses: address, rating, phone, coordinates | $0.045 |
| `/search/shopping` | Products with prices, sellers, ratings | $0.015 |
| `/search/scholar` | Academic papers with citation counts | $0.015 |
| `/search/autocomplete` | Query suggestions (keyword/intent research) | $0.015 |
| `/search/trends` | Interest-over-time timeline | $0.015 |

### Social

| Endpoint | Description | Price |
|----------|-------------|-------|
| `/social/youtube/transcript` | Full video transcript with timestamps | $0.03 |

### Extraction & research

| Endpoint | Description | Price |
|----------|-------------|-------|
| `/extract` | Structured extraction against a JSON schema | $0.03 |
| `/extract/smart` | Natural-language extraction (no schema needed) | $0.035 |
| `/pdf` | Extract text and metadata from a PDF | $0.004 |
| `/answer` | Grounded answer with inline `[n]` citations | $0.05 |
| `/research` | Search + fetch + AI summary with sources | $0.08 |
| `/research/deep` | Multi-step cited research: sub-questions → search each → answer with inline `[n]` citations | $0.20–$0.35 |
| `/compare` | Compare 2–3 webpages with AI analysis | $0.05 |

`/research/deep` is the only long-running endpoint: it plans sub-questions, runs a web search per
sub-question, fetches and dedupes the sources, then synthesizes a cited answer — all in one
synchronous call. A `standard` run (3 sub-questions, 8 sources, $0.20) takes roughly **30–60
seconds**; `deep` (5 sub-questions, 12 sources, $0.35) takes longer. Set a generous HTTP timeout
(120s+) and don't retry on a client timeout, or you'll pay twice.

### Intelligence

| Endpoint | Description | Price |
|----------|-------------|-------|
| `/intel/site-audit` | SEO / performance / security audit | $0.75 |
| `/intel/company` | Company deep dive | $1.00 |
| `/intel/market` | Market research report | $5.00 |
| `/intel/competitive` | Competitive analysis with SWOT | $8.00 |

### Utility

| Endpoint | Description | Price |
|----------|-------------|-------|
| `/memory/set` | Persistent key-value storage for agents | $0.001 |
| `/monitor/create` | URL change monitor with webhooks | $0.01 + $0.001/check |
| `/credits/buy` | Prepay credits (bonus 20–40% at $10/$50/$100) | $2–$1000 |

Free and unauthenticated: `/`, `/health`, `/docs`, `/openapi.json`, `/llms.txt`, `/discovery`, `/.well-known/x402`, `/mcp`, `/r/{url}`, `/s/{query}`, `/free/fetch`, `/free/search`, `/preview`, `/.well-known/agent-registration.json`, `/receipts/{requestId}`, `/feedback`, `/feedback/{id}`.

Dynamically-priced endpoints (`/fetch/pro`, `/extract`) apply a complexity multiplier — up to 3× for bot-protected domains. Cached responses on the fetch family are **70% cheaper**. The exact price is always in the `402` challenge.

## Use with AI agents (MCP)

**Remote HTTP — nothing to install:**
```json
{ "mcpServers": { "weblens": { "url": "https://api.weblens.dev/mcp" } } }
```

**Local with automatic payment:**
```json
{
  "mcpServers": {
    "weblens": {
      "command": "npx",
      "args": ["-y", "@weblens/mcp"],
      "env": { "PRIVATE_KEY": "0xYourPrivateKeyHere" }
    }
  }
}
```

See [mcp-server/README.md](./mcp-server/README.md) for the full tool list and setup.

## API usage

```bash
# Fetch a page as markdown
curl -X POST https://api.weblens.dev/fetch/basic \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'

# Search, with page content included
curl -X POST https://api.weblens.dev/search \
  -H "Content-Type: application/json" \
  -d '{"query": "latest AI news", "limit": 5, "includeContent": true}'

# Structured extraction
curl -X POST https://api.weblens.dev/extract \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/product",
       "schema": {"title": {"type": "string"}, "price": {"type": "number"}},
       "instructions": "Extract the product title and price"}'

# Crawl a site (pay for the page budget you request)
curl -X POST https://api.weblens.dev/crawl \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "limit": 10, "maxDepth": 2}'

# Deep research with inline citations (slow — 30-60s, so raise the client timeout)
curl --max-time 120 -X POST https://api.weblens.dev/research/deep \
  -H "Content-Type: application/json" \
  -d '{"query": "How are AI agents using micropayments in 2026?", "depth": "standard"}'
```

Each returns `402 Payment Required` with the price until you attach payment — see below.

## How payments work

WebLens implements [x402](https://x402.org) v2:

1. `POST` any paid endpoint with no payment.
2. Get `402 Payment Required` with a `PAYMENT-REQUIRED` header carrying the price, network, asset, and pay-to address.
3. Sign a USDC transfer authorization with your wallet.
4. Retry the same request with a `Payment-Signature` header.
5. The payment is verified on-chain and you get your data.

Settlement runs through the [PayAI facilitator](https://facilitator.payai.network) on Base mainnet. Any x402 v2 client works — `@x402/axios`, `@x402/fetch`, or the bundled MCP server, which handles the whole flow for you.

**Prepaid credits** are an alternative to per-request payment: buy credits with `/credits/buy`, then send `X-CREDIT-WALLET` / `X-CREDIT-SIGNATURE` / `X-CREDIT-TIMESTAMP` headers. Failed requests are refunded automatically.

## Development

```bash
pnpm install
pnpm run dev          # local dev server on :8787
pnpm run build        # tsc --noEmit (type check)
pnpm run lint         # eslint
pnpm run test         # vitest (unit + property + workerd integration)
pnpm run deploy       # wrangler deploy (production)
```

Secrets are set with wrangler, never committed:

```bash
wrangler secret put SERP_API_KEY        # search + all verticals + transcripts
wrangler secret put ANTHROPIC_API_KEY   # AI extraction, research, answers, intel
wrangler secret put CDP_API_KEY_ID      # optional: CDP facilitator fallback
wrangler secret put CDP_API_KEY_SECRET
```

| Variable | Purpose |
|----------|---------|
| `PAY_TO_ADDRESS` | Wallet that receives payments (`wrangler.toml` var) |
| `NETWORK` | `base` (production) or `base-sepolia` (testnet) |
| `SERP_API_KEY` | SerpAPI key — search, verticals, YouTube transcripts |
| `ANTHROPIC_API_KEY` | Claude — extraction, research, answers, intel |
| `SIGNING_PRIVATE_KEY` | Optional: HMAC key for proof-of-context tags |
| `PAYAI_FACILITATOR_URL` | Optional: override the facilitator endpoint |

### Testing against testnet

```bash
wrangler dev --env testnet          # Base Sepolia, fake USDC
API_URL=http://localhost:8787 PRIVATE_KEY=0x... npx tsx scripts/test-payment-testnet.ts
```

Get free testnet USDC from the [Circle faucet](https://faucet.circle.com/) on Base Sepolia.

### Discovery

```bash
pnpm run verify-bazaar    # check the x402 discovery extension on every route
```

`/openapi.json` doubles as the discovery document for [x402scan](https://www.x402scan.com/discovery/spec) — it carries `info.x-guidance`, per-operation `x-payment-info`, and `security: []` on free operations. WebLens is listed on x402scan and indexed in the PayAI facilitator catalog.

> **Note on the Coinbase CDP Bazaar:** it only indexes services whose payments the CDP facilitator itself settles. WebLens uses PayAI as its primary facilitator (CDP has an open Base-mainnet settlement bug, [x402#1065](https://github.com/x402-foundation/x402/issues/1065)), so it does not appear there.

## Tech stack

- **Cloudflare Workers** — edge runtime, Durable Objects, KV, Browser Rendering
- **Hono** — web framework
- **x402** — HTTP-native micropayments
- **Zod** — request validation
- **Vitest** + fast-check — unit, property, and real-workerd integration tests

## Links

- [API documentation](https://api.weblens.dev/docs)
- [LLM-optimized guide](https://api.weblens.dev/llms.txt)
- [Service discovery](https://api.weblens.dev/discovery)
- [x402 protocol](https://x402.org)

## License

MIT
