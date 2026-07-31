# WebLens MCP Server

Give your AI agent web superpowers with WebLens. This MCP server lets Claude, Kiro, and other AI agents fetch and render webpages, take screenshots, search the web (plus news, images, places, shopping, scholar, trends), pull YouTube transcripts, extract structured data, answer questions with citations, run multi-step cited deep research, crawl and map sites, and run company/market intelligence - all with automatic x402 micropayments.

## Quick Setup

### Option 1: Remote HTTP Server (Recommended)

No installation needed! Just add the URL to your MCP config:

**For Claude Code (CLI):**
```bash
claude mcp add --transport http weblens https://api.weblens.dev/mcp
```

**For Kiro** (`.kiro/settings/mcp.json`):
```json
{
  "mcpServers": {
    "weblens": {
      "url": "https://api.weblens.dev/mcp"
    }
  }
}
```

**For Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "weblens": {
      "url": "https://api.weblens.dev/mcp"
    }
  }
}
```

> Note: With HTTP transport, you'll need to provide payment via the `Payment-Signature` header (x402 v2) when calling paid tools.

### Option 2: Local Server with Auto-Payment

If you want automatic payment handling, use the local stdio server:

**For Claude Code (CLI):**
```bash
claude mcp add --transport stdio weblens \
  --env PRIVATE_KEY=0xYourPrivateKeyHere \
  -- npx -y @weblens/mcp
```

**For Kiro** (`.kiro/settings/mcp.json`):
```json
{
  "mcpServers": {
    "weblens": {
      "command": "npx",
      "args": ["-y", "@weblens/mcp"],
      "env": {
        "PRIVATE_KEY": "0xYourPrivateKeyHere"
      }
    }
  }
}
```

**For Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "weblens": {
      "command": "npx",
      "args": ["-y", "@weblens/mcp"],
      "env": {
        "PRIVATE_KEY": "0xYourPrivateKeyHere"
      }
    }
  }
}
```

### Windows Users (Local Server)

On Windows (not WSL), use the `cmd /c` wrapper:

```bash
claude mcp add --transport stdio weblens \
  --env PRIVATE_KEY=0xYourPrivateKeyHere \
  -- cmd /c npx -y @weblens/mcp
```

Or in JSON config:

```json
{
  "mcpServers": {
    "weblens": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@weblens/mcp"],
      "env": {
        "PRIVATE_KEY": "0xYourPrivateKeyHere"
      }
    }
  }
}
```

## Requirements

- Node.js 18+
- A wallet with USDC on Base mainnet
- Your wallet's private key (for signing payments)

## Getting USDC on Base

1. Bridge USDC from Ethereum to Base via [bridge.base.org](https://bridge.base.org)
2. Or buy USDC directly on Base via Coinbase

## Available Tools

30 tools, priced per call in USDC on Base. Prices below mirror the live API
(`https://api.weblens.dev/openapi.json`).

### Core — fetch, render, capture

| Tool | Description | Price |
|------|-------------|-------|
| `fetch_webpage` | Fetch a webpage as clean markdown (fast, no JS) | $0.005 |
| `fetch_webpage_pro` | Fetch with full JavaScript rendering, optional CSS-selector wait | $0.015 |
| `fetch_resilient` | Multi-provider fetch with automatic fallback (WebLens → Firecrawl → Zyte) | $0.025 |
| `screenshot` | Capture a webpage screenshot as a base64 PNG | $0.02 |

> The three fetch tools accept `cache` / `cacheTtl`. A cache hit is billed at a 70% discount.

### Search — web and SERP verticals

| Tool | Description | Price |
|------|-------------|-------|
| `search_web` | Real-time web search; set `includeContent` to also fetch top result pages as markdown (+$0.002/result) | $0.015 |
| `search_news` | Google News articles with source, date, thumbnail | $0.015 |
| `search_images` | Google Images with direct URLs, dimensions, source pages | $0.015 |
| `search_places` | Google Local businesses: address, rating, reviews, phone, coordinates | $0.045 |
| `search_shopping` | Google Shopping products with prices, sellers, ratings | $0.015 |
| `search_scholar` | Google Scholar papers with publication info and citation counts | $0.015 |
| `search_autocomplete` | Google Autocomplete suggestions for keyword/intent research | $0.015 |
| `search_trends` | Google Trends interest-over-time timeline | $0.015 |

### Social

| Tool | Description | Price |
|------|-------------|-------|
| `youtube_transcript` | Full YouTube transcript with timestamps (video ID or any YouTube URL) | $0.03 |

### Extraction

| Tool | Description | Price |
|------|-------------|-------|
| `get_contents` | Bulk page text: fetch 1-20 URLs, clean markdown per page | $0.002/URL |
| `extract_data` | AI-powered structured extraction against a JSON schema you supply | $0.03 |
| `smart_extract` | Extraction driven by a natural-language query (no schema needed) | $0.035 |
| `extract_pdf` | Text and metadata from a PDF document | $0.01 |

### Research & analysis

| Tool | Description | Price |
|------|-------------|-------|
| `answer_question` | Grounded answer with inline `[n]` citations, sourced from live web pages | $0.05 |
| `research` | Search + fetch top results + AI summary with key findings | $0.08 |
| `deep_research` | Multi-step cited research: sub-questions → a search each → dedupe sources → answer with inline `[n]` citations, key findings, gaps | $0.20 standard / $0.35 deep |
| `compare_urls` | Compare 2-3 webpages, AI analysis of similarities and differences | $0.05 |

> `deep_research` is **slow by design** — a `standard` run (3 sub-questions, 8 sources) takes
> roughly 30-60 seconds and `deep` (5 sub-questions, 12 sources) takes longer. The tool waits
> up to 180s; if your agent host has its own tool timeout, raise it. Never retry on a client
> timeout — the request may still be settling and you would pay twice.

### Crawling

| Tool | Description | Price |
|------|-------------|-------|
| `batch_fetch` | Fetch 2-20 URLs in parallel | $0.003/URL |
| `map_site` | Discover a site's URLs (robots.txt → sitemaps → link extraction), no page content | $0.01 |
| `crawl_site` | Same-host BFS crawl, markdown for every page, one synchronous call | $0.003/page (1-25) |

> `crawl_site` bills the **requested** page budget (`limit`), not the number of pages returned.

### Intelligence

| Tool | Description | Price |
|------|-------------|-------|
| `intel_company` | Company deep dive: tech stack, funding, team, competitors, news | $1.00 |
| `intel_market` | Market research report: trends, key players, data points, actions | $5.00 |
| `intel_competitive` | Competitive analysis: feature matrix, pricing, SWOT, positioning | $8.00 |
| `intel_site_audit` | SEO, performance and security audit with scoring and recommendations | $0.75 |

### Utility

| Tool | Description | Price |
|------|-------------|-------|
| `monitor_create` | URL change monitor with webhook notifications (1-24h interval) | $0.01 |
| `memory_set` | Store key-value data in persistent agent memory (TTL 1-720h) | $0.001 |

> Prices for `fetch_webpage_pro` and `extract_data` are *base* prices — high-complexity
> domains and deep URLs are quoted with a multiplier in the 402 challenge, which the
> client pays automatically.

## Example Usage

Once configured, your AI agent can use these tools naturally:

> "Fetch the homepage of techcrunch.com and summarize the top stories"

> "Take a screenshot of apple.com"

> "Search for 'best rust web frameworks 2025' and give me the top 5 results"

> "Extract the product name, price and availability from this page as JSON"

> "Answer with citations: what changed in the EU AI Act in 2026?"

> "Do deep research on how AI agents are using micropayments in 2026 — cite your sources" (takes ~30-60s)

> "Map every URL on docs.stripe.com, then crawl the 10 under /payments"

> "Get the transcript of this YouTube video and pull out the three main claims"

> "Give me a competitive analysis of Vercel"

## How Payments Work

WebLens uses the [x402 protocol](https://x402.org) for micropayments:

1. Your agent calls a tool (e.g., `fetch_webpage`)
2. WebLens returns a 402 Payment Required with price
3. The MCP server automatically signs a USDC payment
4. WebLens verifies and returns the data
5. Payment settles on Base (~1-2 seconds)

No accounts, no API keys, no subscriptions - just pay per use.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PRIVATE_KEY` | Yes | Your wallet private key (0x...) |
| `WEBLENS_URL` | No | API URL (default: https://api.weblens.dev) |

## Security

⚠️ **Keep your private key secure!** 

- Never commit it to git
- Use environment variables or a secrets manager
- Consider using a dedicated wallet with limited funds

## Verify Installation

In Claude Code, check that WebLens is connected:

```
/mcp
```

You should see `weblens` listed with its available tools.

## Local Development

```bash
# Clone and install
cd mcp-server
npm install

# Set your private key
export PRIVATE_KEY=0xYourPrivateKeyHere

# Run in development
npm run dev
```

## Troubleshooting

**"Connection closed" on Windows**: Make sure you're using the `cmd /c` wrapper (see Windows setup above).

**Payment fails**: Ensure your wallet has USDC on Base mainnet. Bridge from Ethereum at [bridge.base.org](https://bridge.base.org).

**Server not starting**: Check that Node.js 18+ is installed: `node --version`

## Links

- [WebLens API Docs](https://api.weblens.dev/docs)
- [x402 Protocol](https://x402.org)
- [x402 Documentation](https://x402.gitbook.io/x402)
- [Get USDC on Base](https://bridge.base.org)
- [MCP Documentation](https://modelcontextprotocol.io)

## License

MIT
