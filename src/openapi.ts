/**
 * OpenAPI Documentation Configuration
 * Auto-generated API documentation using Scalar
 */

import { Scalar } from "@scalar/hono-api-reference";
import type { Hono } from "hono";
import { FREE_TIER, PRICING, supportedNetworkNames, supportedNetworks } from "./config";
import type { NetworkEnv } from "./config";
import { ENDPOINT_GROUPS } from "./endpoints/define";
import { llmsEndpointSections, llmsMcpToolLines, openApiPaidPaths } from "./endpoints/docs";
import type { AppEnv } from "./types";

// OpenAPI Document (exported for the discovery-contract tests)
export function getOpenAPIDocument(env: NetworkEnv, baseUrl: string = "https://api.weblens.dev") {
  const networks = supportedNetworkNames(env);
  return {
    openapi: "3.1.0",
    info: {
      title: "WebLens API",
      version: "2.0.0",
      description: `# WebLens - Web Intelligence API, pay per call

Scrape, crawl, map and extract the web. No account, no API key, no monthly
minimum — you pay for the calls you make and nothing else.

## Pricing
Page fetching starts at **${PRICING.fetch.basic}**, whole-site crawling at
**${PRICING.crawl.perPage}/page**, and sitemap discovery at **${PRICING.map}**.
Comparable services bill $0.007-0.008 per request, or reach a lower per-page
rate only on a $99/month commitment. WebLens has no commitment to reach.

## Payment Protocol
All paid endpoints use the [x402 protocol](https://x402.org) for HTTP-native
micropayments (USDC on ${networks}).

## Cache Discount
Cached responses are **70% cheaper** than fresh fetches.`,
      "x-guidance":
        "WebLens is a pay-per-call web intelligence API for AI agents — no accounts, API keys, or monthly minimum. " +
        `Every paid operation is a POST with a JSON body, paid via x402 (USDC on ${networks}): call it, read the ` +
        "PAYMENT-REQUIRED response header from the 402, sign, and retry with Payment-Signature. " +
        `Cheapest and most capable at getting pages: POST /fetch/basic {"url": "..."} scrapes to markdown for ${PRICING.fetch.basic}, ` +
        `POST /crawl {"url": "..."} crawls a whole site for ${PRICING.crawl.perPage}/page, and POST /map {"url": "..."} ` +
        `lists a site's URLs from its sitemap for ${PRICING.map}. ` +
        "Use POST /fetch/pro for JavaScript-rendered pages and POST /extract to pull structured JSON from any page. " +
        "Also available: POST /search for web search and POST /research/deep for multi-step cited research. " +
        "Not sure an endpoint is worth its price? POST /preview {\"endpoint\": \"/answer\"} is free and returns the live " +
        "price plus a real sample of the response shape before you pay. " +
        "Free, unauthenticated try: GET /r/{url} (rate limited).",
      contact: { name: "WebLens Support", url: "https://api.weblens.dev", email: "vassilistotskas@msn.com" },
      license: { name: "MIT", url: "https://opensource.org/licenses/MIT" },
    },
    servers: [
      { url: baseUrl, description: "Production" },
      { url: "http://localhost:8787", description: "Local Development" },
    ],
    tags: [
      { name: "Free", description: "Free tier endpoints — no payment required" },
      ...Object.entries(ENDPOINT_GROUPS).map(([name, description]) => ({ name, description })),
      { name: "System", description: "Health and documentation endpoints" },
      { name: "Discovery", description: "Free evaluation and ERC-8004 off-chain surfaces — previews, receipts, feedback" },
    ],
    paths: {
      "/": { get: { tags: ["System"], summary: "API Info", operationId: "getApiInfo", security: [], responses: { "200": { description: "API info" } } } },
      "/health": { get: { tags: ["System"], summary: "Health Check", operationId: "healthCheck", security: [], responses: { "200": { description: "Health status" } } } },
      "/discovery": {
        get: {
          tags: ["System"],
          summary: "Service Discovery",
          operationId: "getDiscovery",
          security: [],
          description: "Machine-readable service catalog optimized for AI agent discovery. Returns all available endpoints, pricing, capabilities, and integration options.",
          responses: { "200": { description: "Service catalog with endpoints, pricing, and capabilities" } }
        }
      },
      "/.well-known/x402": {
        get: {
          tags: ["System"],
          summary: "x402 Discovery",
          operationId: "getWellKnownX402",
          security: [],
          description: "Standard x402 discovery endpoint. Returns x402-compatible service information for Bazaar indexing.",
          responses: { "200": { description: "x402 service information" } }
        }
      },
      "/r/{url}": {
        get: {
          tags: ["Free"],
          summary: "Reader Mode (Zero-Friction)",
          operationId: "readerFetch",
          security: [],
          description: "Fetch any webpage as markdown with a single GET request. No auth, no payment, no POST body. Just append a URL. Rate limited to 10/hour, content truncated to 2000 chars. Inspired by Jina Reader.",
          parameters: [
            { name: "url", in: "path", required: true, schema: { type: "string" }, description: "Full URL to fetch (e.g. https://example.com/article)", example: "https://example.com" },
            { name: "format", in: "query", required: false, schema: { type: "string", enum: ["json", "text"] }, description: "Response format: json (default) or text (plain markdown)" },
          ],
          responses: {
            "200": { description: "Page content as markdown (JSON or plain text)" },
            "400": { description: "Invalid or missing URL" },
            "429": { description: "Rate limit exceeded (10/hour)" },
            "502": { description: "Target URL timeout" },
          },
        },
      },
      "/credits/balance": {
        get: {
          tags: ["Credits"], summary: "Get Balance", operationId: "getCreditsBalance",
          description: "Get current credit balance. Requires X-CREDIT-WALLET and X-CREDIT-SIGNATURE headers.",
          security: [],
          parameters: [
            { name: "X-CREDIT-WALLET", in: "header", required: true, schema: { type: "string" } },
            { name: "X-CREDIT-SIGNATURE", in: "header", required: true, schema: { type: "string" } },
            { name: "X-CREDIT-TIMESTAMP", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Balance info" }, "401": { description: "Invalid signature" } },
        },
      },
      "/credits/history": {
        get: {
          tags: ["Credits"], summary: "Get History", operationId: "getCreditsHistory",
          description: "Get credit transaction history. Requires X-CREDIT-WALLET and X-CREDIT-SIGNATURE headers.",
          security: [],
          parameters: [
            { name: "X-CREDIT-WALLET", in: "header", required: true, schema: { type: "string" } },
            { name: "X-CREDIT-SIGNATURE", in: "header", required: true, schema: { type: "string" } },
            { name: "X-CREDIT-TIMESTAMP", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Transaction history" }, "401": { description: "Invalid signature" } },
        },
      },
      "/free/fetch": {
        post: {
          tags: ["Free"], summary: "Free Fetch", operationId: "freeFetch",
          description: "Fetch any webpage (content truncated to 2000 chars). Rate limited to 10/hour. No payment required.",
          security: [],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["url"], properties: { url: { type: "string" }, timeout: { type: "integer" } } } } } },
          responses: { "200": { description: "Page content (truncated)" }, "400": { description: "Invalid request" }, "429": { description: "Rate limit exceeded" } },
        },
      },
      "/preview": {
        post: {
          tags: ["Discovery"], summary: "Preview a Paid Endpoint", operationId: "previewEndpoint",
          security: [],
          description: "See what a paid endpoint costs and what it returns BEFORE paying. Free, rate limited to 10/hour per IP. Returns the live price (derived from the same PRICING source as the 402 challenge), a one-line summary, and a recorded sample of the exact response shape. A real, truncated LIVE preview runs only for endpoints whose marginal cost is a plain fetch (currently /fetch/basic, /contents, /map) and only when you pass a url; endpoints backed by a metered upstream (SerpAPI, Anthropic) never run live for free and return the recorded sample instead. Responds 404 for an endpoint that is not sold.",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PreviewRequest" }, example: { endpoint: "/answer" } } } },
          responses: {
            "200": { description: "Price, summary, recorded sample and (when available) a live truncated preview", content: { "application/json": { schema: { $ref: "#/components/schemas/PreviewResponse" } } } },
            "400": { description: "Invalid body, or an unsafe/malformed url", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "404": { description: "Unknown endpoint — it is not one of the paid endpoints. See /discovery for the catalogue.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "429": { description: "Rate limit exceeded (10/hour)" },
          },
        },
      },
      "/.well-known/agent-registration.json": {
        get: {
          tags: ["Discovery"], summary: "ERC-8004 Registration Document", operationId: "getAgentRegistration",
          security: [],
          description: "ERC-8004 (Trustless Agents) registration document: name, description, image, services, x402 support, payment info, and the feedback endpoints. WebLens hosts only the OFF-CHAIN half of ERC-8004 — it is not registered on-chain, holds no agent id, and writes nothing to any registry, so `registrations` stays empty until someone registers this URI on an Identity Registry. `supportedTrust` is [\"feedback\"]: no crypto-economic or TEE-attestation claims are made.",
          responses: { "200": { description: "Registration document", content: { "application/json": { schema: { $ref: "#/components/schemas/AgentRegistration" } } } } },
        },
      },
      "/receipts/{requestId}": {
        get: {
          tags: ["Discovery"], summary: "Get Call Receipt", operationId: "getReceipt",
          security: [],
          description: "Receipt for a paid call — endpoint, status, outcome, charged price, payment method, network, pay-to address, settlement transaction and payer. Every paid response carries `X-Receipt-Id` and `X-Receipt-Url` headers pointing here. Receipts are kept for 30 days. A receipt is unsigned: its evidence is the settlement transaction, which anyone can check on-chain.",
          parameters: [{ name: "requestId", in: "path", required: true, schema: { type: "string" }, description: "The X-Request-Id / X-Receipt-Id of the paid call" }],
          responses: {
            "200": { description: "Receipt for the call", content: { "application/json": { schema: { $ref: "#/components/schemas/CallReceipt" } } } },
            "404": { description: "No receipt for that request id (receipts are issued for paid calls and kept 30 days)", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/feedback": {
        post: {
          tags: ["Discovery"], summary: "Host an ERC-8004 Feedback Document", operationId: "submitFeedback",
          security: [],
          description: "Host a buyer-authored ERC-8004 feedback document and get back the (feedbackURI, feedbackHash) pair that `giveFeedback()` on a Reputation Registry expects. The document is stored verbatim and served back byte-for-byte from GET /feedback/{id}, so its keccak-256 hash matches the hash returned here. WebLens neither authors nor alters the document and never calls the registry — the buyer posts giveFeedback() themselves. Free, rate limited to 10/hour per IP. Limits: body ≤ 256KB, nesting ≤ 32 levels.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/FeedbackDocument" },
                example: {
                  agentRegistry: "eip155:8453:0x0000000000000000000000000000000000000000",
                  agentId: "42",
                  clientAddress: "0x1234567890abcdef1234567890abcdef12345678",
                  createdAt: "2026-07-31T12:00:00.000Z",
                  value: 95,
                  valueDecimals: 0,
                  tag1: "quality",
                  endpoint: "/answer",
                },
              },
            },
          },
          responses: {
            "201": { description: "Document hosted; use feedbackURI + feedbackHash in giveFeedback()", content: { "application/json": { schema: { $ref: "#/components/schemas/FeedbackHosted" } } } },
            "400": { description: "Body is not a JSON object, nests deeper than 32 levels, or is missing required ERC-8004 fields (the response names them)", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "413": { description: "Body exceeds the 256KB limit", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
            "429": { description: "Rate limit exceeded (10/hour)" },
          },
        },
      },
      "/feedback/{id}": {
        get: {
          tags: ["Discovery"], summary: "Get a Hosted Feedback Document", operationId: "getFeedbackDocument",
          security: [],
          description: "Serves a hosted feedback document verbatim — the bytes are exactly what was hashed, so keccak-256 of this response equals the feedbackHash returned by POST /feedback. This URL is the feedbackURI.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, description: "Id from the feedbackURI returned by POST /feedback" }],
          responses: {
            "200": { description: "The stored document, byte-for-byte", content: { "application/json": { schema: { $ref: "#/components/schemas/FeedbackDocument" } } } },
            "404": { description: "No feedback document with that id", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/mcp": {
        post: {
          tags: ["System"], summary: "MCP JSON-RPC", operationId: "mcpPost",
          description: "Model Context Protocol endpoint for AI agents. Supports tools/list and tools/call methods.",
          security: [],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { jsonrpc: { type: "string" }, method: { type: "string" }, params: { type: "object" }, id: { type: "string" } } } } } },
          responses: { "200": { description: "JSON-RPC response" }, "402": { $ref: "#/components/responses/PaymentRequired" } },
        },
      },
      "/mcp/info": {
        get: {
          tags: ["System"], summary: "MCP Server Info", operationId: "mcpInfo",
          description: "Get MCP server information including available tools and pricing.",
          security: [],
          responses: { "200": { description: "Server info with tools list" } },
        },
      },
      ...openApiPaidPaths(),
    },
    components: {
      schemas: {
        ErrorResponse: { type: "object", properties: { error: { type: "string" }, code: { type: "string" }, message: { type: "string" }, requestId: { type: "string" } } },
        PreviewRequest: {
          type: "object", required: ["endpoint"],
          properties: {
            endpoint: { type: "string", minLength: 1, maxLength: 100, example: "/answer", description: "Paid endpoint path to preview, e.g. \"/answer\" (a leading slash is added if you omit it)" },
            url: { type: "string", format: "uri", example: "https://example.com", description: "Fetch-backed endpoints only (/fetch/basic, /contents, /map): run a real truncated preview of this URL" },
          },
        },
        PreviewResponse: {
          type: "object",
          properties: {
            endpoint: { type: "string" },
            method: { type: "string" },
            price: { type: "string", description: "Human-readable price, resolved from the same PRICING source as the 402 challenge" },
            currency: { type: "string" },
            summary: { type: "string", description: "One line on what the paid call returns" },
            sample: { type: "object", description: "Recorded example of the real response shape" },
            sampleType: { type: "string", enum: ["recorded"] },
            live: { type: "object", description: "Present only when a live preview ran: { url, title, content, truncatedAt, note } — or { error } if the fetch failed" },
            livePreviewAvailable: { type: "boolean", description: "True only for endpoints with no paid upstream (currently /fetch/basic, /contents, /map)" },
            livePreviewHint: { type: "string" },
            docs: { type: "string" },
            schema: { type: "string", description: "URL of the OpenAPI document" },
            previewedAt: { type: "string" },
            requestId: { type: "string" },
          },
        },
        AgentRegistration: {
          type: "object",
          properties: {
            type: { type: "string", description: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1" },
            name: { type: "string" },
            description: { type: "string" },
            image: { type: "string" },
            active: { type: "boolean" },
            x402Support: { type: "boolean" },
            services: { type: "array", items: { type: "object", properties: { name: { type: "string" }, endpoint: { type: "string" }, version: { type: "string" } } } },
            registrations: { type: "array", items: { type: "object", properties: { agentId: { type: "string" }, agentRegistry: { type: "string" } } }, description: "Empty: WebLens is not registered on-chain and holds no agent id" },
            supportedTrust: { type: "array", items: { type: "string" }, description: "[\"feedback\"] — the only trust model actually supported today" },
            payment: { type: "object", properties: { protocol: { type: "string" }, version: { type: "integer" }, networks: { type: "array", items: { type: "string" } }, asset: { type: "string" }, priceRange: { type: "string" } } },
            feedback: { type: "object", properties: { receiptEndpoint: { type: "string" }, submitEndpoint: { type: "string" }, hashAlgorithm: { type: "string" } } },
          },
        },
        CallReceipt: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["weblens-call-receipt-v1"] },
            requestId: { type: "string" },
            endpoint: { type: "string" },
            method: { type: "string" },
            status: { type: "integer", description: "HTTP status the caller received" },
            outcome: { type: "string", enum: ["success", "error"] },
            price: { type: "string", description: "Charged price, e.g. \"$0.015\". Absent when the call was not charged." },
            currency: { type: "string", enum: ["USD"] },
            paymentMethod: { type: "string", description: "\"x402\" or \"credits\"" },
            network: { type: "string" },
            payTo: { type: "string" },
            transaction: { type: "string", description: "Settlement transaction (EVM tx hash or Solana signature) — the on-chain proof of payment. Absent for credits." },
            payer: { type: "string", description: "Address that paid" },
            servedAt: { type: "string" },
          },
        },
        FeedbackDocument: {
          type: "object",
          required: ["agentRegistry", "agentId", "clientAddress", "createdAt", "value", "valueDecimals"],
          description: "Buyer-authored ERC-8004 feedback document. Extra fields are preserved verbatim.",
          properties: {
            agentRegistry: { type: "string", description: "CAIP-10 style address of the Identity Registry the agentId belongs to" },
            agentId: { type: "string" },
            clientAddress: { type: "string", description: "Wallet posting giveFeedback()" },
            createdAt: { type: "string" },
            value: { type: "number", description: "Score, scaled by valueDecimals" },
            valueDecimals: { type: "integer" },
            tag1: { type: "string" },
            tag2: { type: "string" },
            endpoint: { type: "string", description: "WebLens endpoint the feedback is about" },
            proofOfPayment: { type: "string", description: "e.g. the X-Receipt-Url of the paid call" },
          },
        },
        FeedbackHosted: {
          type: "object",
          properties: {
            feedbackURI: { type: "string", description: "Pass to giveFeedback() — GET it to retrieve the exact bytes that were hashed" },
            feedbackHash: { type: "string", description: "keccak-256 of the canonical document bytes" },
            storedAt: { type: "string" },
            hashAlgorithm: { type: "string", enum: ["keccak256"] },
            note: { type: "string" },
            requestId: { type: "string" },
          },
        },
      },
      responses: {
        PaymentRequired: {
          description: "Payment required — x402 v2 protocol. Parse the PAYMENT-REQUIRED response header (base64-encoded JSON), sign the payment with your wallet, then retry the request with the Payment-Signature request header.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                description: "Body is empty {} on a 402 — payment requirements are in the PAYMENT-REQUIRED response header.",
              },
            },
          },
          headers: {
            "PAYMENT-REQUIRED": {
              description: "Base64-encoded JSON with the x402 v2 payment requirements: { x402Version: 2, error, resource, accepts: [{ scheme, network, amount, asset, payTo, maxTimeoutSeconds, extra }] }",
              schema: { type: "string" },
            },
            "PAYMENT-RESPONSE": {
              description: "Base64-encoded settlement receipt (txHash, network) — returned on a successful response that delivers a paid resource.",
              schema: { type: "string" },
            },
          },
        },
      },
      securitySchemes: {
        x402Payment: {
          type: "apiKey",
          in: "header",
          name: "Payment-Signature",
          description: "x402 v2 payment payload (base64-encoded signed payment)",
        },
      },
    },
    security: [{ x402Payment: [] }],
  };
}

/**
 * Register OpenAPI documentation routes
 */
export function registerOpenAPIRoutes(app: Hono<AppEnv>) {
  // OpenAPI JSON spec
  app.get("/openapi.json", (c) => {
    const baseUrl = new URL(c.req.url).origin;
    return c.json(getOpenAPIDocument(c.env, baseUrl));
  });

  // Scalar API Reference UI
  app.get(
    "/docs",
    Scalar({
      url: "/openapi.json",
      pageTitle: "WebLens API Documentation",
      theme: "kepler",
      favicon: "/favicon.svg",
    })
  );

  // LLMs.txt for AI agents - comprehensive API documentation
  app.get("/llms.txt", (c) => {
    const llmsTxt = `# WebLens

> Scrape, crawl, map and extract the web. Pay per call, no account, no monthly minimum.

WebLens gets pages for AI agents: a single URL as markdown, a whole site crawled,
a site's URL list from its sitemap, or structured JSON pulled out of any page.
Paid endpoints settle over the x402 protocol (USDC on ${supportedNetworkNames(c.env)}) — no accounts, no API keys.

## What It Costs

| Job | Endpoint | Price |
|-----|----------|-------|
| One page as markdown | POST /fetch/basic | ${PRICING.fetch.basic} |
| Whole site, crawled | POST /crawl | ${PRICING.crawl.perPage}/page |
| A site's URLs (sitemap) | POST /map | ${PRICING.map} |
| Many pages at once | POST /contents | ${PRICING.contents.perUrl}/URL |
| JavaScript-rendered page | POST /fetch/pro | ${PRICING.fetch.pro} |
| Structured JSON from a page | POST /extract | ${PRICING.extract} |
| Who owns a domain + its stack | POST /domain | ${PRICING.domain} |
| What a site is built on | POST /tech | ${PRICING.tech} |
| Is this package safe to use | POST /package | ${PRICING.package} |
| What HN said about a topic | POST /discussions | ${PRICING.discussions} |
| Is this project legit (off-chain) | POST /intel/project | ${PRICING.intel.project} |

Comparable search/scrape APIs bill $0.007-0.008 per request, or reach a lower
per-page rate only on a ~$99/month plan. WebLens has no plan to commit to, and
cached responses are another 70% off.

## Why Choose WebLens?

- **Zero friction**: No accounts, API keys, or subscriptions - just pay per request
- **Cheapest per page**: fetching and crawling run on Cloudflare's edge, and the price reflects it
- **AI-optimized**: Designed for autonomous agents with structured outputs
- **Instant settlement**: Payments settle on-chain in seconds (${supportedNetworkNames(c.env)})
- **No fees**: x402 protocol has 0 platform fees
- **Discoverable**: Indexed in the PayAI facilitator discovery catalog; standard x402 discovery at /.well-known/x402 and OpenAPI at /openapi.json

## Try It Now (Zero-Friction Reader)

Fetch any webpage as markdown with a single GET request — no auth, no payment, no setup:

  GET https://api.weblens.dev/r/https://example.com

Add ?format=text for plain output. Rate limited to ${String(FREE_TIER.maxRequestsPerHour)}/hour;
content truncated to ${String(FREE_TIER.fetchMaxContentLength)} chars.
Upgrade to the paid endpoints for full content.

## Preview Before You Pay (Free)

Don't guess whether an endpoint is worth its price — ask:

  POST /preview {"endpoint": "/answer"}

Free (rate limited to 10/hour), and it returns the live price for that endpoint, a one-line
summary, and a recorded \`sample\` showing the exact response shape you would get.

LIVE vs RECORDED — the rule:
- Endpoints whose marginal cost is a plain fetch (/fetch/basic, /contents, /map) can also run a
  REAL truncated preview: pass a \`url\` and you get back a \`live\` block with the first 500
  characters of the actual result. \`livePreviewAvailable\` is true for exactly these.
- Every other endpoint is backed by a metered upstream (SerpAPI, Anthropic). Running those free
  would burn upstream credits, so they never run live — you get the recorded sample instead, which
  still shows every field name and type.

Unknown or unsold endpoint → 404.

## ERC-8004 (Trustless Agents) — Off-Chain Surfaces

WebLens hosts the OFF-CHAIN half of ERC-8004, which is what a service operator can run without
deploying a contract. WebLens is NOT registered on-chain, holds no agent id, and writes nothing to
any registry.

#### GET /.well-known/agent-registration.json
The ERC-8004 registration document (type \`…eip-8004#registration-v1\`): name, description, image,
services, active, x402Support, payment info, and the feedback endpoints. \`registrations\` is empty
because there is no on-chain registration; \`supportedTrust\` is ["feedback"]. (Free)

#### GET /receipts/{requestId}
The receipt for a paid call — your payment evidence. Every paid response returns \`X-Receipt-Id\`
and \`X-Receipt-Url\` headers pointing at it. Kept 30 days. (Free)
- Returns: \`{"type": "weblens-call-receipt-v1", "requestId", "endpoint", "method", "status", "outcome", "price?", "currency", "paymentMethod", "network", "payTo", "transaction?", "payer?", "servedAt"}\`
- The receipt is unsigned. Its evidence is \`transaction\`, which anyone can check on-chain.

#### POST /feedback
Host a feedback document YOU author, and get back the pair \`giveFeedback()\` wants. WebLens stores
it verbatim and never edits or authors it; you post giveFeedback() yourself. (Free, rate limited)
- Body must include: \`agentRegistry\`, \`agentId\`, \`clientAddress\`, \`createdAt\`, \`value\`, \`valueDecimals\` (optional: \`tag1\`, \`tag2\`, \`endpoint\`, \`proofOfPayment\`, …)
- Returns 201: \`{"feedbackURI", "feedbackHash", "storedAt", "hashAlgorithm": "keccak256", "note", "requestId"}\`
- Missing a required field → 400 naming exactly which ones.
- Limits: body ≤ 256KB (413 past that), nesting ≤ 32 levels. Unknown fields are kept — they are part of what gets hashed.

#### GET /feedback/{id}
Serves the stored document byte-for-byte, so keccak-256 of the response equals the
\`feedbackHash\` you were given. This URL is the \`feedbackURI\`. (Free)

## Quick Start for AI Agents

0. Free evaluation: POST /preview {"endpoint": "/answer"} — see the price and response shape first
1. Try the free reader: GET /r/https://example.com (no wallet needed!)
2. For full access, call any paid endpoint (e.g., POST /fetch/basic with {"url": "https://example.com"})
3. Receive 402 Payment Required — read the PAYMENT-REQUIRED response header (base64-encoded JSON) for amount, asset, payTo and accepts
4. Sign USDC payment using your wallet (Base network)
5. Retry with the Payment-Signature header containing the signed payload
6. Receive data; settlement receipt is in the PAYMENT-RESPONSE response header

## Discovery Endpoints

- GET /r/{url} - Zero-friction reader (free, no auth needed)
- POST /preview - Price + real response sample for any paid endpoint, before you pay (free)
- GET /discovery - Full service catalog with all endpoints, pricing, and capabilities
- GET /.well-known/x402 - Standard x402 discovery for Bazaar indexing
- GET /.well-known/agent-registration.json - ERC-8004 registration document (off-chain)
- GET /receipts/{requestId} - Receipt for a paid call (free)
- POST /feedback, GET /feedback/{id} - Host/serve an ERC-8004 feedback document (free)
- GET /mcp/info - MCP server information for AI agent integration

## API Base URL

- Production: https://api.weblens.dev
- Documentation: https://api.weblens.dev/docs
- OpenAPI Spec: https://api.weblens.dev/openapi.json
- Discovery: https://api.weblens.dev/discovery

## Payment Protocol

All paid endpoints use [x402 v2](https://x402.org) micropayments:
1. Make a request to any endpoint
2. Receive \`402 Payment Required\` — payment details are in the \`PAYMENT-REQUIRED\` response header (base64-encoded JSON; body is empty)
3. Sign a USDC payment with your wallet (Base network)
4. Retry the request with the \`Payment-Signature\` header containing the signed payload
5. Receive the response with a \`PAYMENT-RESPONSE\` header (settlement proof)

Supported networks: ${supportedNetworkNames(c.env)} (CAIP-2: ${supportedNetworks(c.env).join(", ")})
Token: USDC

## Endpoints

${llmsEndpointSections()}
### System

#### GET /
API information and documentation links. (Free)

#### GET /health
Health check endpoint. (Free)
- Returns: \`{"status", "version", "timestamp"}\`

#### GET /docs
Interactive API documentation (Scalar UI). (Free)

#### GET /openapi.json
OpenAPI 3.1 specification. (Free)

#### POST /mcp
Model Context Protocol endpoint for AI agents. Supports JSON-RPC with tools/list and tools/call methods.
- Free (tool calls are paid per-endpoint)

#### GET /mcp/info
MCP server information including available tools and pricing. (Free)

## MCP Integration

For AI agents using Model Context Protocol:

### Remote HTTP (no install)
\`\`\`json
{
  "mcpServers": {
    "weblens": {
      "url": "https://api.weblens.dev/mcp"
    }
  }
}
\`\`\`

## Available MCP Tools

- \`preview_endpoint\` - Price + real response sample for any paid endpoint, before paying — free
${llmsMcpToolLines()}

### Agent Credits (Prepaid)

Bypass per-request x402 signatures by pre-funding an account with POST /credits/buy (see Credits above).

#### GET /credits/balance
Check current credit balance.
- Header: \`X-CREDIT-WALLET\`: Your wallet address
- Header: \`X-CREDIT-SIGNATURE\`: Signature of "WebLens Auth..." message

## Response Headers

All responses include:
- \`X-Request-Id\` - Unique request identifier
- \`X-Processing-Time\` - Processing time in milliseconds
- \`PAYMENT-RESPONSE\` - Settlement proof (on a successful paid response)
- \`X-Receipt-Id\` / \`X-Receipt-Url\` - Receipt for a paid call, fetchable at GET /receipts/{requestId} for 30 days

## Error Handling

Errors return JSON with:
\`\`\`json
{
  "error": "Error type",
  "code": "ERROR_CODE",
  "message": "Human-readable message",
  "requestId": "uuid"
}
\`\`\`

## Cache Discount

Cached responses are ${String(Math.round(PRICING.cacheDiscount * 100))}% cheaper than fresh fetches. Use \`cache: true\` in fetch requests.

## Links

- Website: https://api.weblens.dev
- Documentation: https://api.weblens.dev/docs
- x402 Protocol: https://x402.org
`;
    return c.text(llmsTxt);
  });
}