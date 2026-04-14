# x402 Foundation submission

Drop these assets into a fork of `github.com/x402-foundation/x402` to list
WebLens under **Services/Endpoints** on https://www.x402.org/ecosystem.

## Paths

In the fork, place the files at:

| Source here | Destination in x402-foundation/x402 |
|---|---|
| `metadata.json` | `typescript/site/app/ecosystem/partners-data/weblens/metadata.json` |
| `logo.svg` | `typescript/site/public/logos/weblens.svg` |

Then open a PR. SLA is ~5 business days and includes co-marketing on approval.

## PR description template

```
Add WebLens to Services/Endpoints

WebLens is an x402-monetized web intelligence API on Cloudflare Workers:
- Live at https://api.weblens.dev (128+ days)
- 18 paid endpoints (fetch, screenshot, search, extract, research, intel)
- USDC on Base mainnet via PayAI (primary) + CDP (fallback) facilitators
- Also ships an MCP server (@weblens/mcp) and Coinbase AgentKit provider
- Discovery: https://api.weblens.dev/.well-known/x402  ·  /discovery  ·  /llms.txt
```
