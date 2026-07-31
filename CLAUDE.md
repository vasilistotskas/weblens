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

> **pnpm 11**: pnpm-specific settings live in `pnpm-workspace.yaml` (the `pnpm` field in `package.json` is no longer read) — `allowBuilds` (replaces `onlyBuiltDependencies`), `blockExoticSubdeps: false` (viem@2.51 pulls `ox` from a pkg.pr.new tarball), plus `peerDependencyRules`/`overrides`/`allowedDeprecatedVersions`. `LOG_LEVEL` is a `[vars]` entry in `wrangler.toml`. `mcp-server/` is a **separate** npm package (own lockfile/build), not part of the workspace.

## Architecture

### Runtime & Framework
- **Cloudflare Workers** with `nodejs_compat` flag
- **Hono** web framework with typed `Env` bindings and `Variables` context
- **ES modules** (`"type": "module"`, target ESNext, bundler module resolution)
- **JSX** configured for Hono (`jsxImportSource: "hono/jsx"`)

### Entry Point & Middleware Chain (`src/index.ts`)
Global middleware applied in this order, then route groups registered:

1. Logger → CORS → Payment Debug → Request ID (also creates the request-scoped structured logger) → Security Headers → POST-only enforcement (for `PAID_ENDPOINTS` array). Global errors are caught by `app.onError(errorHandler)` (idiomatic Hono) — **not** a `*` middleware — and the 404 by `app.notFound`.
2. Route groups registered in order: System → Reader → Free → Credits → Core → Verticals → Advanced → Intel

Durable Object classes (`CreditAccountDO`, `MonitorScheduler`) are re-exported from the entry point for Workers binding.

### Key Directories
- **`src/routes/`** — Route registrars grouped by tier (system, reader, free, credits, core, verticals, advanced, intel). Each function takes the Hono app and registers endpoints with their middleware stack. `verticals.ts` holds the SERP verticals (`/search/news|images|places|shopping|scholar|autocomplete|trends`), `/social/youtube/transcript`, `/contents` (per-URL dynamic pricing), and `/answer`. `advanced.ts` holds `/batch/fetch`, `/research`, `/pdf`, `/compare`, `/map`, and `/crawl` (per-page dynamic pricing).
- **`src/tools/`** — Endpoint handler implementations. Each tool is a Hono handler that reads `validatedBody` from context, calls services/external APIs, and returns a flat domain object plus `requestId` and a per-endpoint ISO timestamp field (`fetchedAt` / `searchedAt` / `extractedAt` / `analyzedAt` / etc.).
- **`src/services/`** — Business logic layer (pricing, caching, credits DO proxy, scheduler DO, crypto/ACV proofs, AI/Anthropic integration, reputation).
- **`src/middleware/`** — Middleware factories: payment (x402 lazy-init singleton), credit-middleware (wallet signature auth + debit), validation (Zod), rate-limit (IP-based via KV), cache, security, error handler.
- **`src/durable_objects/`** — Cloudflare Durable Objects. `CreditAccountDO` manages atomic credit transactions via key-value Durable Object storage (`ctx.storage.get/put` — not the SQL API), exposes `/deposit`, `/spend`, `/balance`, `/history` internal endpoints. Keeps max 100 transactions (LIFO).
- **`src/schemas.ts`** — All Zod request validation schemas. Reusable primitives: `urlSchema`, `timeoutSchema`, `limitSchema`. Includes bounds (viewport 320-3840px, timeout 5-30s, cache TTL 60-86400s).
- **`src/config.ts`** — Centralized pricing, network/facilitator config, cache settings, viewport bounds, timeouts. All prices defined here. **Pricing floor rule:** every SerpAPI-backed endpoint (search family, verticals, transcript) costs $0.009–$0.015 upstream per call depending on plan tier — never price those below $0.015. `/answer` bundles a SerpAPI call + a capped Haiku call (~$0.026 worst case) — keep its price ≥ 2x that.
- **`src/types.ts`** — All TypeScript interfaces: `Env` (Worker bindings), `Variables` (Hono context vars), request/response types, `ErrorCode` enum, `ProofOfContext`.
- **`src/openapi.ts`** — OpenAPI 3.1 spec generation, Scalar UI at `/docs`, `/llms.txt` endpoint with LLM-optimized API guide. The spec doubles as the **x402scan discovery document** (`/openapi.json`): `info.x-guidance`, per-op `x-payment-info` (fixed or dynamic price mode, derived from `PRICING`/`MAX_COMPLEXITY_MULTIPLIER` — never hardcoded), `security: []` on free/auth-gated ops, and request `example`s so registration probes can reach the 402 challenge. All `llms.txt` prices interpolate `PRICING` too.

### Hono Context Variables
Middleware stores state in Hono context (`c.set()`/`c.get()`):
- `requestId` — UUID generated at ingress
- `validatedBody` — Zod-parsed request body (set by validation middleware, consumed by handlers)
- `paidWithCredits` — boolean flag; when `true`, x402 payment middleware is skipped
- `startTime` — `Date.now()` for `X-Processing-Time` header calculation
- `log` — request-scoped structured `Logger` bound with `requestId`/method/path; use `c.get("log").info("event.name", {fields})` (set by Request ID middleware, always present)
- `cacheHit` / `cacheKey` / `cacheTtl` / `cachedBody` — set by the cache middleware (see Caching)

### Adding a New Endpoint
Each paid endpoint follows this middleware composition pattern in a route registrar:
```
app.use("/path", validateRequest(ZodSchema))                // Zod validation → sets validatedBody
app.use("/path", createCreditMiddleware(price, label))      // credit account check + debit
app.use("/path", createLazyPaymentMiddleware(...))          // x402 payment wall
app.post("/path", handlerFunction)                          // tool handler
```
The order is **validation → credit → payment → handler** on every paid route: invalid bodies are rejected before any money moves, and both money middlewares can read `c.get("validatedBody")`. Handlers read `c.get("validatedBody")` (no per-handler re-parse) and `c.get("requestId")`. Free endpoints use `rateLimitMiddleware` + `validateRequest` with their own free-tier schemas (exported from `src/tools/free.ts`). Dynamically-priced endpoints (`/fetch/pro`, `/extract` complexity pricing in `src/routes/core.ts`; `/batch/fetch` per-URL in `src/routes/advanced.ts`) define ONE price resolver and pass it to BOTH `createCreditMiddleware` and `createLazyPaymentMiddleware` so the credit debit and the x402 challenge can never charge different amounts. Cacheable endpoints prepend `cacheLookupMiddleware` and append `cacheServeMiddleware` (see Caching); `cacheAwarePrice()` wraps the resolver for both money paths.

### Payment System (x402 Protocol)
- Client sends POST without payment → gets 402 with price/network/address
- Client signs USDC transfer, retries with `Payment-Signature` header (x402 v2)
- `@x402/hono` middleware verifies on-chain, request proceeds
- Payment middleware uses **lazy initialization** — `getResourceServer()` creates a singleton on first request, cached at module scope in `src/middleware/payment.ts`
- Static pricing middleware is also cached; dynamic pricing (for extract/fetch-pro) re-evaluates per request via callback
- Facilitator selection happens at runtime in `getResourceServer()` (`src/middleware/payment.ts`) based on env: `NETWORK=base-sepolia` (or a `FACILITATOR_URL` containing `x402.org`) → x402.org testnet facilitator; else if `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` are set → **PayAI primary + CDP fallback** (two `HTTPFacilitatorClient`s; PayAI wins precedence for shared scheme/network combos because the CDP facilitator has known Base-mainnet gas-estimation issues — coinbase/x402#1065 — so CDP is kept only as a fallback for schemes PayAI doesn't advertise); else → PayAI only. The chosen branch is logged at init (`wrangler tail` shows e.g. `Facilitator: payai (primary) + cdp (fallback)`). `SUPPORTED_NETWORKS` in `config.ts` currently only contains `["base"]`.
- `payment-debug.ts` middleware logs EIP-3009 authorization structure for diagnosing CDP facilitator failures

### Credit System (Alternative to Per-Request Payment)
Three-layer architecture:
1. **Credit middleware** (`src/middleware/credit-middleware.ts`) — intercepts `X-CREDIT-WALLET` header, verifies the EIP-191 wallet signature via `verifyWalletSignature()` (one-directional timestamp window: ≤5min old, ≤60s future skew) with KV-backed **replay protection** (each signature consumed once via a `sigreplay:` nonce in CACHE), then attempts debit. On insufficient funds, gracefully falls through to x402 payment. **Refunds:** handlers report failures by returning JSON error envelopes (not throwing), so the middleware refunds the debit both when `next()` throws AND when the final `c.res.status >= 400` — refunds are idempotent via the `refund:${requestId}` externalId. Success responses carry `Payment-Method: Credits` + `Credit-Cost`; refunded ones carry `Payment-Method: Credits` + `Credit-Refunded`.
2. **CreditAccountDO** (`src/durable_objects/CreditAccountDO.ts`) — atomic balance management per wallet. Tiers: standard → premium ($100 deposited) → enterprise ($1000). Transaction history capped at 100 entries.
3. **Credit service** (`src/services/credits.ts`) — DO proxy functions. Bonus tiers: 20% at $10, 30% at $50, 40% at $100+ (descending sort for highest applicable match).

### Error Handling
- Registered via `app.onError(errorHandler)` (`src/middleware/errorHandler.ts`) — idiomatic Hono; catches throws from any middleware/handler regardless of order, logs the error through the structured logger, and returns the envelope. `ERROR_CODE_MAP` does substring matching on the message → `ErrorCode`.
- Consistent envelope: `{error, code, message, requestId, retryAfter?}` where **`error` always equals `code`** (machine-readable); human text goes in `message`. New codes must be added to the `ErrorCode` union in `types.ts`.
- Status mapping in `getHttpStatus()`: 400/401/402/404/405/413/422/429/500/502/503.

### Logging & Observability (`src/utils/logger.ts`)
- Structured JSON to `console.*` (Cloudflare Workers Logs auto-indexes the fields — no logging lib). `createLogger`/`loggerFromEnv(env)`/`mask()`; levels gated by `env.LOG_LEVEL`, mapped to `console.error/warn/log` for severity.
- Request path uses `c.get("log")`; DOs use `loggerFromEnv(this.env)`; services take an optional `Logger`. Event names are dotted (`credit.debit`, `provider.fallback`). **Never log** secrets/signatures/raw headers; `mask()` wallets. `wrangler.toml [observability]` on with `head_sampling_rate` (0.1 prod / 1 testnet).

### URL Validation & SSRF (`src/services/validator.ts`, `src/utils/safe-fetch.ts`)
- `validateURL()` **canonicalizes** IPv4 literals in any encoding (dotted/octal/hex/shorthand/bare-int) and range-checks against private blocks; also blocks non-canonical encodings, RFC1918/loopback/link-local/CGNAT, IPv6 loopback/ULA/link-local, embedded credentials, `.onion`, and non-HTTP(S) schemes. Returns `{valid, normalized?, error?}`.
- `safeFetch()` re-validates **every redirect hop** (manual redirect) — use it for any fetch of a user-supplied URL (all fetch tools + provider-registry native path do).
- Browser-rendered endpoints (`/fetch/pro`, `/screenshot`) can't use `safeFetch` — Chromium follows redirects itself — so `hardenPage()` (`src/utils/browser-guard.ts`) enables Puppeteer request interception and re-validates **every request the page makes** (navigation, redirect hops, subresources) against `validateURL()`. Any new Puppeteer usage must call `hardenPage(page)` right after `newPage()`.
- The validation middleware rejects bodies over 256KB (`MAX_BODY_BYTES` in `src/middleware/validation.ts`) before parsing; `cacheLookupMiddleware` enforces the same bound because it parses the body first on cacheable routes.

### Provider Chain (`src/services/provider-registry.ts`)
`/fetch/resilient` tries the native `safeFetch` scraper first, then re-fetches through **Cloudflare Browser Rendering** (`hardenPage` applied) for client-rendered pages and sites that refuse bare HTTP clients. The response reports which tier served it. The chain previously listed "Firecrawl → Zyte via x402", but that path returned "not yet implemented" on 402 and both advertised endpoints 404 — the endpoint was charging 5x `/fetch/basic` for plain fetch plus two doomed requests. Adding a real third-party tier would require WebLens to hold a funded wallet and sign outbound x402 payments; don't advertise such a tier until it actually settles.

### Crawling (`src/services/crawler.ts`, `src/tools/map.ts`, `src/tools/crawl.ts`)
- `/map` discovers URLs without fetching content: robots.txt `Sitemap:` directives → `/sitemap.xml` → nested sitemap indexes (bounded by `CRAWL_LIMITS.maxSitemapDocs`) → homepage link extraction as fallback. Real sites nest — both developers.cloudflare.com and x402.org serve a sitemap *index*, so index recursion is mandatory, not optional.
- `/crawl` is a **bounded synchronous** same-host BFS returning markdown per page. Deliberately not an async job: polling would need either a free status endpoint (abuse vector) or a second payment, neither of which fits x402's one-shot-per-request model. Workers paid plans allow 10k subrequests/invocation and bill CPU only (not network wait), so a 1–25 page crawl fits comfortably. Batched at `CRAWL_LIMITS.concurrency`.
- Billing: the caller pays for the **requested page budget** (`limit × PRICING.crawl.perPage`), not pages returned — one resolver feeds both the credit debit and the x402 challenge.
- Safety: same-host only, every discovered link re-validated through `validateURL()` before fetch (link/sitemap data is attacker-controlled), all fetches via `safeFetch`, non-HTML content types rejected, and robots.txt honoured by default (`respectRobots: false` opt-out; start URL disallowed → 403 `FORBIDDEN`).

### Probe-Friendly Validation (`src/middleware/validation.ts`)
Unauthenticated POSTs to a path in `PAID_ENDPOINTS` (`src/config.ts`, also used by the POST-only middleware) **skip** body validation and fall through to the x402 payment middleware, so the caller gets the 402 challenge instead of a 400. Rationale: such a request can never reach the handler (payment middleware always 402s it), and production logs showed ~170 bare probes to `/intel/site-audit` bouncing as 400 — the exact "Expected 402, got 400" failure x402scan documents. Requests carrying `Payment-Signature` or `X-CREDIT-WALLET` keep strict validation so money never moves on an invalid body; the 256KB cap still applies to everyone. Covered by `tests/unit/validation-probe.test.ts`.

### Caching
- Opt-in via the `cache` body field (default `true`) on the fetch family (`/fetch/basic`, `/fetch/pro`, `/fetch/resilient`); implemented in `src/middleware/cache.ts` + `src/services/cache.ts`. On a hit the cached body is served (handler skipped) and the 70% discount applies to both the credit debit and the x402 challenge.
- Cache keys: `weblens:{endpoint}:{sha256(sorted_params)[:12]}`
- TTL clamped to 60-86400s; default 3600s
- 70% discount on cached responses (`PRICING.cacheDiscount`)
- KV-backed via CACHE namespace

### Dynamic Pricing (`src/services/pricing.ts`)
- `getComplexityMultiplier()` analyzes URLs: HIGH_COMPLEXITY_DOMAINS (Twitter, Facebook, LinkedIn, Amazon, Booking, Airbnb) get 3.0x multiplier
- Deep paths (>3 segments) or many query params (>2) get 1.5x
- `calculatePrice()` returns 4-decimal precision for USDC atomic units
- `getPriceRange()` derives the advertised price range from `PRICING` (single source of truth for discovery/MCP/docs — no hardcoded range strings)
- `getCachedPrice()` applies the 70% cache discount; used by the cache middleware's `cacheAwareCreditCost`/`cacheAwarePaymentPrice`
- `src/services/reputation.ts` — mock placeholder for ERC-8004 reputation discounts (hardcoded wallets for now)

### Crypto & Proof of Context (`src/services/crypto.ts`)
- `hashContent()` — SHA-256 via `crypto.subtle`
- `signContext()` — ACV (Autonomous Context Verification): handlers compose `hashContent` + `signContext` into a `ProofOfContext` `{hash, timestamp, alg, mac, keyId}`. `mac` is a symmetric HMAC tag (a MAC), **not** a public-key signature — only the secret holder can verify it
- Uses HMAC-SHA256 keyed by `SIGNING_PRIVATE_KEY` (falls back to `CDP_API_KEY_SECRET`); since it is symmetric it is not third-party-verifiable — true ECDSA signing is a roadmap item

### Cloudflare Bindings (wrangler.toml)
- **KV namespaces**: CACHE, MEMORY, MONITOR
- **Durable Objects**: CREDIT_MANAGER (CreditAccountDO), MONITOR_SCHEDULER (MonitorScheduler with SQLite)
- **Browser**: Cloudflare Browser Rendering binding (for `/fetch/pro`, `/screenshot`; requires paid Workers plan)
- **Environments**: production (Base mainnet, custom domain `api.weblens.dev`) and testnet (Base Sepolia, `workers_dev = true`)

### Testing
- **Vitest 4** + **fast-check**. `vitest.config.ts` defines two `projects` (`pnpm run test` runs both):
  - **`node`** — pure-logic unit/property tests in `tests/properties/` + `tests/unit/`; production code importing `cloudflare:workers` is aliased to `tests/mocks/cloudflare-workers.ts`.
  - **`workers`** — `tests/workers/` run in the **real workerd runtime** via `@cloudflare/vitest-pool-workers` (`cloudflareTest()` plugin reading `wrangler.toml`), with real KV/DO bindings. `CreditAccountDO` is tested here: `import { env } from "cloudflare:workers"` + `runInDurableObject`/`runDurableObjectAlarm` from `cloudflare:test`. Add binding/DO tests here, not in the node project.
- Request handlers/schemas are tested by their **canonical Zod schema** (the validatedBody contract), not local mocks. Coverage: pricing, credit DO ledger (real), rate limiting, schema contracts, cache key/TTL/discount, SSRF encodings, crypto/ACV, response headers, resilient-fetch fallback.

### MCP Integration (`src/tools/mcp.ts`)
Model Context Protocol JSON-RPC handler at `/mcp` — enables AI agents to discover and use WebLens tools via MCP protocol.

### Discovery & Bazaar (`src/tools/discovery.ts`, `src/openapi.ts`)
- `/discovery` — machine-readable `SERVICE_CATALOG` for autonomous agent discovery
- `/.well-known/x402` — standard x402 discovery endpoint
- `/openapi.json` — x402scan discovery document (register at x402scan.com/resources/register; requires `info.x-guidance` + per-op `x-payment-info` + `security: []` on free ops per x402scan.com/discovery/spec)
- Uses `@x402/extensions/bazaar` (`declareDiscoveryExtension` in `src/middleware/payment.ts`) — this got WebLens indexed in the **PayAI facilitator discovery catalog** (facilitator.payai.network/discovery/resources, 12 endpoints listed). The **CDP Bazaar** (api.cdp.coinbase.com …/x402/discovery/resources) indexes ONLY services whose payments the CDP facilitator itself settles — with PayAI as primary facilitator, CDP never settles, so WebLens is not in the CDP Bazaar. Flipping precedence would expose real payments to CDP's still-open Base-mainnet settle bug (x402-foundation/x402#1065); the indexing pipeline also has an open bug (#2112).
- `patches/@x402__extensions@2.19.0.patch` (pnpm patch, wired in `pnpm-workspace.yaml` `patchedDependencies`): `@x402/hono`'s middleware runs an advisory Ajv validation of each route's bazaar extension on cold start, but Ajv compiles schemas via `new Function` — forbidden in workerd — which spammed a paired error+warn per paid route per isolate in production logs. The patch passes `logger: false` to Ajv and treats the codegen-disallowed `EvalError` as "skip validation" instead of a failure. Discovery itself was never affected (the extension is not dropped on validation failure). Re-check on `@x402/*` upgrades past 2.19.0 — drop the patch if upstream handles no-codegen runtimes.
