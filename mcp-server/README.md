# WebLens MCP Server

Give your AI agent web superpowers with WebLens. This MCP server lets Claude, Kiro, and other AI agents fetch webpages, take screenshots, search the web, and extract data - all with automatic x402 micropayments.

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

> Note: With HTTP transport, you'll need to provide payment via the `X-PAYMENT` header when calling paid tools.

### Option 2: Local Server with Auto-Payment

If you want automatic payment handling, use the local stdio server:

**For Claude Code (CLI):**
```bash
claude mcp add --transport stdio weblens \
  --env PRIVATE_KEY=0xYourPrivateKeyHere \
  -- npx -y weblens-mcp
```

**For Kiro** (`.kiro/settings/mcp.json`):
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

**For Claude Desktop** (`claude_desktop_config.json`):
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

### Windows Users (Local Server)

On Windows (not WSL), use the `cmd /c` wrapper:

```bash
claude mcp add --transport stdio weblens \
  --env PRIVATE_KEY=0xYourPrivateKeyHere \
  -- cmd /c npx -y weblens-mcp
```

Or in JSON config:

```json
{
  "mcpServers": {
    "weblens": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "weblens-mcp"],
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

| Tool | Description | Price |
|------|-------------|-------|
| `fetch_webpage` | Fetch webpage as markdown (no JS) | $0.005 |
| `fetch_webpage_pro` | Fetch with JavaScript rendering | $0.015 |
| `screenshot` | Capture webpage screenshot | $0.02 |
| `search_web` | Real-time web search | $0.005 |
| `extract_data` | Extract data with CSS selectors | $0.03 |
| `smart_extract` | AI-powered data extraction | $0.035 |
| `research` | Search + fetch + AI summary | $0.08 |
| `extract_pdf` | Extract text from PDFs | $0.01 |
| `compare_urls` | Compare 2-3 webpages | $0.05 |
| `batch_fetch` | Fetch multiple URLs | $0.003/URL |

## Example Usage

Once configured, your AI agent can use these tools naturally:

> "Fetch the homepage of techcrunch.com and summarize the top stories"

> "Take a screenshot of apple.com"

> "Search for 'best rust web frameworks 2025' and give me the top 5 results"

> "Extract all product prices from this Amazon page"

> "Research the current state of AI regulation in the EU"

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
