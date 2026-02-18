# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WebLens is a premium web intelligence API running on **Cloudflare Workers** with **Hono** as the web framework. It provides web scraping, search, extraction, and research tools, monetized via the **x402 micropayment protocol** (HTTP 402 Payment Required with on-chain USDC verification). The live API is at `api.weblens.dev`.

External API dependencies: **SerpAPI** (web search), **Anthropic** (AI extraction/research), **Firecrawl** and **Zyte** (fallback scraping providers), **Cloudflare Browser Rendering** (JS rendering, screenshots).

## Commands

```bash
# Development (local Cloudflare Workers dev server)
pnpm run dev                      # wrangler dev (port 8787)
wrangler dev --env testnet        # testnet mode (Base Sepolia, fake USDC)

# Type checking
pnpm run build                    # tsc --noEmit (also: pnpm run typecheck)

# Testing
pnpm run test                     # vitest run (all property-based tests)
npx vitest run test/properties/credits.test.ts   # single test file

# Linting
pnpm run lint                     # eslint src scripts
pnpm run lint:fix                 # auto-fix

# Deploy
pnpm run deploy                   # wrangler deploy (production)

# Secrets (never committed, set via wrangler or Cloudflare dashboard)
wrangler secret put CDP_API_KEY_ID
wrangler secret put CDP_API_KEY_SECRET
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put SERP_API_KEY
```

## Architecture

### Runtime & Framework
- **Cloudflare Workers** with `nodejs_compat` flag
- **Hono** web framework with typed `Env` bindings and `Variables` context
- **ES modules** (`"type": "module"`, target ESNext, bundler module resolution)
- **JSX** configured for Hono (`jsxImportSource: "hono/jsx"`)

### Entry Point & Middleware Chain (`src/index.ts`)
Global middleware applied in this order, then route groups registered:

1. Logger → CORS → Payment Debug → Request ID → Security Headers → Error Handler → POST-only enforcement (for `PAID_ENDPOINTS` array)
2. Route groups registered in order: System → Free → Credits → Core → Advanced → Intel

Durable Object classes (`CreditAccountDO`, `MonitorScheduler`) are re-exported from the entry point for Workers binding.

### Key Directories
- **`src/routes/`** — Route registrars grouped by tier (system, free, core, advanced, intel, credits). Each function takes the Hono app and registers endpoints with their middleware stack.
- **`src/tools/`** — Endpoint handler implementations. Each tool is a Hono handler that reads `validatedBody` from context, calls services/external APIs, and returns `{data, requestId, timestamp}`.
- **`src/services/`** — Business logic layer (pricing, caching, credits DO proxy, scheduler DO, crypto/ACV proofs, AI/Anthropic integration, reputation).
- **`src/middleware/`** — Middleware factories: payment (x402 lazy-init singleton), credit-middleware (wallet signature auth + debit), validation (Zod), rate-limit (IP-based via KV), cache, security, error handler.
- **`src/durable_objects/`** — Cloudflare Durable Objects. `CreditAccountDO` manages atomic credit transactions with SQLite backend, exposes `/deposit`, `/spend`, `/balance`, `/history` internal endpoints. Keeps max 100 transactions (LIFO).
- **`src/schemas.ts`** — All Zod request validation schemas. Reusable primitives: `urlSchema`, `timeoutSchema`, `limitSchema`. Includes bounds (viewport 320-3840px, timeout 5-30s, cache TTL 60-86400s).
- **`src/config.ts`** — Centralized pricing, network/facilitator config, cache settings, viewport bounds, timeouts. All prices defined here.
- **`src/types.ts`** — All TypeScript interfaces: `Env` (Worker bindings), `Variables` (Hono context vars), request/response types, `ErrorCode` enum, `ProofOfContext`.
- **`src/openapi.ts`** — OpenAPI 3.0.3 spec generation, Scalar UI at `/docs`, `/llms.txt` endpoint with LLM-optimized API guide.
- **`src/skills/`** — Coinbase AgentKit `ActionProvider` integration (`WebLensActionProvider.ts`) wrapping endpoints for autonomous agents.

### Hono Context Variables
Middleware stores state in Hono context (`c.set()`/`c.get()`):
- `requestId` — UUID generated at ingress
- `validatedBody` — Zod-parsed request body (set by validation middleware, consumed by handlers)
- `paidWithCredits` — boolean flag; when `true`, x402 payment middleware is skipped
- `startTime` — `Date.now()` for `X-Processing-Time` header calculation

### Adding a New Endpoint
Each paid endpoint follows this middleware composition pattern in a route registrar:
```
app.use("/path", createCreditMiddleware(price, label))     // credit account check
app.use("/path", validateRequest(ZodSchema))                // Zod validation → sets validatedBody
app.use("/path", createLazyPaymentMiddleware(...))          // x402 payment wall
app.post("/path", handlerFunction)                          // tool handler
```
The order matters: credit check → validation → payment → handler. Free endpoints use `rateLimitMiddleware` instead of payment middleware.

### Payment System (x402 Protocol)
- Client sends POST without payment → gets 402 with price/network/address
- Client signs USDC transfer, retries with `X-PAYMENT` header
- `@x402/hono` middleware verifies on-chain, request proceeds
- Payment middleware uses **lazy initialization** — `getResourceServer()` creates a singleton on first request, cached at module scope in `src/middleware/payment.ts`
- Static pricing middleware is also cached; dynamic pricing (for extract/fetch-pro) re-evaluates per request via callback
- Networks: Base mainnet (production, PayAI facilitator), Base Sepolia (testnet, x402.org facilitator). Solana/Polygon configured but `SUPPORTED_NETWORKS` currently only includes `["base"]`
- `payment-debug.ts` middleware logs EIP-3009 authorization structure for diagnosing CDP facilitator failures

### Credit System (Alternative to Per-Request Payment)
Three-layer architecture:
1. **Credit middleware** (`src/middleware/credit-middleware.ts`) — intercepts `X-CREDIT-WALLET` header, verifies wallet signature (timestamp + ECDSA via `verifyWalletSignature()`), attempts debit. On insufficient funds, gracefully falls through to x402 payment.
2. **CreditAccountDO** (`src/durable_objects/CreditAccountDO.ts`) — atomic balance management per wallet. Tiers: standard → premium ($100 deposited) → enterprise ($1000). Transaction history capped at 100 entries.
3. **Credit service** (`src/services/credits.ts`) — DO proxy functions. Bonus tiers: 20% at $10, 30% at $50, 40% at $100+ (descending sort for highest applicable match).

### Error Handling
- Global error handler (`src/middleware/errorHandler.ts`) uses `ERROR_CODE_MAP` — substring pattern matching on error messages to classify into `ErrorCode` enum values
- Consistent response envelope: `{error, code, message, requestId, retryAfter?}`
- Status code mapping: 400 (validation), 402 (payment), 404 (not found), 422 (unprocessable), 429 (rate limit), 500/502/503 (server errors)

### URL Validation (`src/services/validator.ts`)
Blocks private/internal IPs (RFC 1918 ranges, localhost, 127.0.0.1, decimal IP tricks), `.onion` domains, non-HTTP(S) schemes. Returns `{valid, normalized?, error?}`.

### Caching
- Opt-in via `cache=true` query param on requests
- Cache keys: `weblens:{endpoint}:{sha256(sorted_params)[:12]}`
- TTL clamped to 60-86400s; default 3600s
- 70% discount on cached responses (`PRICING.cacheDiscount`)
- KV-backed via CACHE namespace

### Dynamic Pricing (`src/services/pricing.ts`)
- `getComplexityMultiplier()` analyzes URLs: HIGH_COMPLEXITY_DOMAINS (Twitter, Facebook, LinkedIn, Amazon, Booking, Airbnb) get 3.0x multiplier
- Deep paths (>3 segments) or many query params (>2) get 1.5x
- `calculatePrice()` returns 4-decimal precision for USDC atomic units
- `src/services/reputation.ts` — mock placeholder for ERC-8004 reputation discounts (hardcoded wallets for now)

### Crypto & Proof of Context (`src/services/crypto.ts`)
- `hashContent()` — SHA-256 via `crypto.subtle`
- `createProofOfContext()` — ACV (Autonomous Context Verification) wrapping content with `{hash, timestamp, signature, publicKey}`
- Currently uses HMAC-SHA256 with `CDP_API_KEY_SECRET`; roadmap item to upgrade to ECDSA

### Cloudflare Bindings (wrangler.toml)
- **KV namespaces**: CACHE, MEMORY, MONITOR, CREDITS
- **Durable Objects**: CREDIT_MANAGER (CreditAccountDO), MONITOR_SCHEDULER (MonitorScheduler with SQLite)
- **Browser**: Cloudflare Browser Rendering binding (for `/fetch/pro`, `/screenshot`; requires paid Workers plan)
- **Environments**: production (Base mainnet, custom domain `api.weblens.dev`) and testnet (Base Sepolia, `workers_dev = true`)

### Testing
- **Vitest** with property-based tests using **fast-check**
- All tests in `tests/` — `tests/properties/` (property-based), `tests/unit/` (unit), `tests/integration/` (integration)
- Cloudflare Workers runtime mocked via `tests/mocks/cloudflare-workers.ts` (aliased in `vitest.config.ts` so `import from "cloudflare:workers"` resolves to mock)
- Tests cover: pricing calculations, credit middleware/deduction, rate limiting, validation bounds, cache TTL clamping, batch pricing, response headers, multi-chain support, resilient fetch fallback logic

### MCP Integration (`src/tools/mcp.ts`)
Model Context Protocol JSON-RPC handler at `/mcp` — enables AI agents to discover and use WebLens tools via MCP protocol.

### Discovery & Bazaar (`src/tools/discovery.ts`)
- `/discovery` — machine-readable `SERVICE_CATALOG` for autonomous agent discovery
- `/.well-known/x402` — standard x402 Bazaar discovery endpoint
- Uses `@x402/extensions/bazaar` for automatic indexing
