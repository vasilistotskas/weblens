# Awesome x402 Submission: WebLens

## Entry for README.md

Add under the **Services** or **APIs** section:

```markdown
- [WebLens](https://api.weblens.dev) - Web Intelligence API for AI agents. 15+ endpoints: web scraping, JS rendering, screenshots, search, AI extraction, research, PDF parsing, URL monitoring, and more. Pay-per-request with USDC on Base. Free reader at `GET /r/{url}`. [Docs](https://api.weblens.dev/docs) | [OpenAPI](https://api.weblens.dev/openapi.json) | [MCP](https://api.weblens.dev/mcp)
```

---

## PR Title

```
Add WebLens - Web Intelligence API for AI agents
```

## PR Description

### What is WebLens?

WebLens is a web intelligence API built on Cloudflare Workers that gives AI agents web superpowers. It provides 15+ endpoints for web scraping, screenshot capture, data extraction, AI-powered research, PDF parsing, URL monitoring, and persistent memory — all paid per-request with USDC on Base via x402.

### x402 Integration

- Full x402 v2 compliance with HTTP 402 responses and `PAYMENT-REQUIRED` header
- USDC payments on Base network (eip155:8453)
- CDP facilitator for payment verification
- `/.well-known/x402` discovery endpoint with Bazaar extensions
- Bazaar-compatible service catalog at `/discovery`
- `@x402/hono` middleware with `@x402/evm` ExactEvmScheme
- `@x402/extensions/bazaar` for automatic Bazaar indexing

### Pricing

| Endpoint | Price |
|----------|-------|
| Fetch (basic) | $0.005 |
| Fetch (JS rendering) | $0.015 |
| Screenshot | $0.02 |
| Web search | $0.005 |
| Data extraction | $0.03 |
| AI research | $0.08 |
| Batch fetch | $0.003/URL |
| PDF extraction | $0.01 |
| URL comparison | $0.05 |
| Memory storage | $0.001 |

70% cache discount on all endpoints.

### Free Tier

- `GET /r/{url}` — Zero-friction reader, no auth needed
- `POST /free/fetch` — Truncated content (2000 chars)
- `POST /free/search` — Max 3 results
- All rate-limited to 10 requests/hour per IP

### Integration

- **MCP**: Remote HTTP endpoint at `/mcp` with 10 tools
- **OpenAPI**: Full spec at `/openapi.json`
- **LLMs.txt**: AI-optimized guide at `/llms.txt`
- **Credit system**: Pre-fund wallet for bulk usage with bonus tiers

### Links

- Live API: https://api.weblens.dev
- Documentation: https://api.weblens.dev/docs
- Discovery: https://api.weblens.dev/discovery
- x402 Discovery: https://api.weblens.dev/.well-known/x402
- MCP: https://api.weblens.dev/mcp
- Free Reader: https://api.weblens.dev/r/https://example.com

### Tech Stack

Cloudflare Workers, Hono, TypeScript, @x402/hono, @x402/evm, @x402/extensions/bazaar, @coinbase/x402
