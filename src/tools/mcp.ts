/**
 * MCP (Model Context Protocol) HTTP Endpoint
 * Allows AI agents to connect via HTTP transport
 * 
 * Supports Streamable HTTP transport as per MCP spec
 */

import type { Context } from "hono";
import { supportedNetworkNames, supportedNetworks } from "../config";
import { ENDPOINTS } from "../endpoints";
import { describePrice, requestBodySchema } from "../endpoints/define";
import { PreviewRequestSchema } from "../schemas";
import { getPriceRange } from "../services/pricing";
import type { AppEnv, Env } from "../types";

// MCP Protocol version
const MCP_VERSION = "2025-06-18";

/**
 * Request headers a `tools/call` carries through onto the tool's own endpoint.
 *
 * The x402 payload, the three credit-account headers, and the caller's edge IP.
 * Only `Payment-Signature` used to be forwarded, so a buyer holding prepaid
 * credits could not spend them through MCP even though the identical call
 * worked over plain HTTP.
 *
 * Forwarding `cf-connecting-ip` is not a trust hole: the rate limiter reads
 * only that header *because* Cloudflare's edge overwrites it on the way in, so
 * the value copied here is the edge-set one from the outer request. Without it
 * every MCP-originated call to a free, rate-limited endpoint shares a single
 * "unknown" bucket and one noisy client throttles everyone.
 */
const FORWARDED_REQUEST_HEADERS = [
  "Payment-Signature",
  "X-CREDIT-WALLET",
  "X-CREDIT-SIGNATURE",
  "X-CREDIT-TIMESTAMP",
  "cf-connecting-ip",
] as const;

/**
 * Hono's ExecutionContext shape, taken from Context so it always agrees with
 * what `app.fetch` accepts — the global workers-types `ExecutionContext`
 * declares extra members (`tracing`, `abort`) that Hono's does not.
 */
type HonoExecutionContext = Context<AppEnv>["executionCtx"];

/**
 * How a `tools/call` reaches WebLens' own endpoints.
 *
 * A tool call has to run the real middleware chain (validation -> credit ->
 * payment -> handler) so the x402 wall still issues the 402 and money moves
 * exactly as it does over plain HTTP. That used to be done with
 * `fetch(new URL(c.req.url).origin + endpoint)` — the Worker fetching its own
 * hostname — which cannot work here: WebLens runs on a Cloudflare **Custom
 * Domain** (`custom_domain = true` in wrangler.toml), and Cloudflare documents
 * that a Worker fetching its own hostname returns 522. Production agreed —
 * every `tools/call` answered `{"error":{"code":522}}`, free tools included,
 * from the day the self-fetch landed (2025-11) until this replaced it.
 *
 * Dispatching into the app's own fetch handler keeps the whole chain, spends no
 * subrequest, and removes the failure mode instead of working around it. The
 * documented alternative — the `global_fetch_strictly_public` compatibility
 * flag — keeps the round trip and bills a second Worker invocation per call.
 */
export type McpDispatcher = (
  request: Request,
  env: Env,
  ctx?: HonoExecutionContext
) => Response | Promise<Response>;

let mcpDispatcher: McpDispatcher | undefined;

/**
 * Registered by the Worker entry (`src/index.ts`) with the Hono app itself.
 * Accepts `undefined` so a test can assert the unregistered path directly.
 */
export function setMcpDispatcher(dispatcher: McpDispatcher | undefined): void {
  mcpDispatcher = dispatcher;
}

async function dispatchToolRequest(
  request: Request,
  c: Context<AppEnv>
): Promise<Response> {
  if (!mcpDispatcher) {
    // No entry point registered one. Throwing beats falling back to a
    // self-`fetch`, which is the bug this replaced.
    throw new Error(
      "MCP dispatcher not registered — the Worker entry must call setMcpDispatcher()"
    );
  }
  // `c.executionCtx` throws when the runtime supplied none; the cache
  // middleware already tolerates that, so pass it on only when it exists.
  let ctx: HonoExecutionContext | undefined;
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = undefined;
  }
  return mcpDispatcher(request, c.env, ctx);
}

/** Base64 -> JSON, for the `PAYMENT-REQUIRED` challenge header. */
function decodeBase64Json(value: string): unknown {
  try {
    const bytes = Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

/**
 * The JSON-RPC error for a tool call that still needs paying.
 *
 * x402 v2 carries the challenge in the base64 `PAYMENT-REQUIRED` *response
 * header* and leaves the 402 body as `{}`. Reading the body — which is what
 * this did — handed MCP clients an empty object: no amount, no asset, no
 * payTo, nothing signable. Return the decoded challenge, and the raw header
 * beside it so a client can pass it straight to an x402 client library.
 */
export function paymentRequiredError(
  response: Response,
  toolConfig: { endpoint: string; price: string }
): { code: number; message: string; data: Record<string, unknown> } {
  const header = response.headers.get("PAYMENT-REQUIRED");
  const challenge = header !== null ? decodeBase64Json(header) : undefined;

  return {
    code: 402,
    message: `Payment required: ${toolConfig.price} for ${toolConfig.endpoint}`,
    data: {
      endpoint: toolConfig.endpoint,
      price: toolConfig.price,
      ...(header !== null && { paymentRequiredHeader: header }),
      ...(challenge !== undefined && { paymentRequired: challenge }),
      howToPay:
        "Decode the base64 paymentRequiredHeader (or read the decoded paymentRequired), sign one " +
        "of its `accepts` entries with your wallet, then retry this tools/call with the signed " +
        "payload in the Payment-Signature header. Prepaid credits work too — send X-CREDIT-WALLET, " +
        "X-CREDIT-SIGNATURE and X-CREDIT-TIMESTAMP instead.",
    },
  };
}

/** Prefer the API's own error envelope over a bare body when a tool call fails. */
async function toolErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { code?: string; message?: string };
    if (parsed.message) {
      return parsed.code ? `${parsed.code}: ${parsed.message}` : parsed.message;
    }
  } catch {
    // Not an error envelope — fall through to the raw body.
  }
  return text;
}

/** Paid endpoints offered as MCP tools: every registry definition with an `mcpTool` name. */
const PAID_TOOLS = ENDPOINTS.flatMap((endpoint) =>
  endpoint.mcpTool === undefined ? [] : [{ name: endpoint.mcpTool, endpoint }]);

// Tool definitions. Exported for the MCP-contract test, which samples each
// tool's declared inputSchema and asserts the endpoint's Zod schema accepts it.
export const TOOLS = [
  {
    name: "preview_endpoint",
    description: "FREE. See what a paid WebLens endpoint costs and what it returns before paying: the live price, a one-line summary, and a recorded sample of the exact response shape. Endpoints with no paid upstream (/fetch/basic, /contents, /map) also run a real truncated LIVE preview when you pass a url; SerpAPI- and Anthropic-backed endpoints return the recorded sample only, because free live runs there would burn upstream credits. Price: free",
    inputSchema: requestBodySchema(PreviewRequestSchema),
  },
  ...PAID_TOOLS.map(({ name, endpoint }) => ({
    name,
    description: `${endpoint.description} Price: ${describePrice(endpoint)}`,
    inputSchema: requestBodySchema(endpoint.input),
  })),
];

// Single source of truth used by both `tools/call` (to forward the request to
// the right HTTP endpoint) and `/mcp/info` (to expose structured pricing).
// `Partial<Record<...>>` lets us safely index by an unknown tool name and
// branch on undefined for unknown tools.
export const TOOL_ENDPOINTS: Partial<Record<string, { endpoint: string; method: string; price: string }>> = {
  preview_endpoint: { endpoint: "/preview", method: "POST", price: "free" },
  ...Object.fromEntries(PAID_TOOLS.map(({ name, endpoint }) => [
    name,
    { endpoint: endpoint.path, method: "POST", price: describePrice(endpoint) },
  ])),
};

// Server identity, as the `serverInfo` object the initialize result requires.
// It must stay a nested object: clients read result.serverInfo.name.
const SERVER_INFO = {
  name: "weblens",
  version: "2.1.0",
};

// Server capabilities
const SERVER_CAPABILITIES = {
  tools: {},
};

/**
 * Handle MCP JSON-RPC requests
 */
interface JsonRpcRequest {
  method: string;
  params?: Record<string, unknown>;
  id?: string | number;
}

type JsonRpcResponse = {
  jsonrpc: string;
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
} | null;

async function handleJsonRpc(request: JsonRpcRequest, c: Context<AppEnv>): Promise<JsonRpcResponse> {
  const { method, id } = request;
  const params = request.params;

  // A JSON-RPC request with no `id` is a notification and MUST NOT be
  // answered. MCP clients send `notifications/initialized` immediately after
  // the handshake; replying to it (previously with -32601, because only the
  // bare name "initialized" was handled) is a protocol violation that breaks
  // compliant clients. The caller turns null into a 202.
  if (id === undefined) {
    return null;
  }

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: MCP_VERSION,
          capabilities: SERVER_CAPABILITIES,
          serverInfo: SERVER_INFO,
        },
      };

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: TOOLS,
        },
      };

    case "tools/call": {
      const toolParams = params as ToolCallParams | undefined;
      if (!toolParams?.name) {
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32602,
            message: "Missing tool name in params",
          },
        };
      }
      return await handleToolCall(toolParams, id, c);
    }

    case "ping":
      return {
        jsonrpc: "2.0",
        id,
        result: {},
      };

    default:
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      };
  }
}


/**
 * Handle tool calls - returns 402 for payment
 */
interface ToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

async function handleToolCall(params: ToolCallParams, id: string | number | undefined, c: Context<AppEnv>): Promise<JsonRpcResponse> {
  const { name, arguments: args } = params;

  const toolConfig = TOOL_ENDPOINTS[name];
  if (!toolConfig) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32602,
        message: `Unknown tool: ${name}`,
      },
    };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  for (const header of FORWARDED_REQUEST_HEADERS) {
    const value = c.req.header(header);
    if (value !== undefined) {
      headers[header] = value;
    }
  }

  try {
    const response = await dispatchToolRequest(
      new Request(new URL(toolConfig.endpoint, c.req.url), {
        method: toolConfig.method,
        headers,
        body: JSON.stringify(args),
      }),
      c
    );

    if (response.status === 402) {
      return {
        jsonrpc: "2.0",
        id,
        error: paymentRequiredError(response, toolConfig),
      };
    }

    if (!response.ok) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: response.status,
          message: await toolErrorMessage(response),
        },
      };
    }

    const result: unknown = await response.json();
    const paymentResponse = response.headers.get("PAYMENT-RESPONSE");

    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        ...(paymentResponse && { _meta: { "x402/payment-response": paymentResponse } }),
      },
    };
  } catch (error) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: `Internal error: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
    };
  }
}

/**
 * MCP HTTP POST handler
 */
export async function mcpPostHandler(c: Context<AppEnv>) {
  const contentType = c.req.header("Content-Type");
  
  if (!contentType?.includes("application/json")) {
    return c.json({ error: "Content-Type must be application/json" }, 400);
  }

  try {
    const jsonRequest: JsonRpcRequest = await c.req.json();
    const response = await handleJsonRpc(jsonRequest, c);

    if (response === null) {
      return new Response(null, { status: 202 });
    }

    return c.json(response, 200, {
      "MCP-Protocol-Version": MCP_VERSION,
    });
  } catch {
    return c.json({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: "Parse error",
      },
    }, 400);
  }
}

/**
 * GET /mcp — decline the optional server-to-client SSE stream.
 *
 * Streamable HTTP lets a client open an SSE stream here so the server can push
 * requests and notifications unprompted. WebLens has nothing to push: every
 * tool call is a self-contained request/response paid at its own endpoint. The
 * spec covers exactly this case — the server "MUST respond with
 * Content-Type: text/event-stream or 405 Method Not Allowed" — so 405 is the
 * conformant answer, not a gap. Clients do try it (~1.5k GETs a week).
 *
 * Body is the standard error envelope like every other error the API returns;
 * MCP clients key off the status, so this only has to be consistent.
 */
export function mcpGetHandler(c: Context<AppEnv>) {
  return c.json(
    {
      error: "METHOD_NOT_ALLOWED",
      code: "METHOD_NOT_ALLOWED",
      message:
        "This MCP endpoint does not offer a server-to-client SSE stream. " +
        "Send JSON-RPC requests as POST /mcp.",
      method: "GET",
      path: "/mcp",
      allowedMethods: ["POST"],
      requestId: c.get("requestId"),
    },
    405,
    { Allow: "POST" },
  );
}

/**
 * MCP info endpoint
 */
export function mcpInfoHandler(c: Context<AppEnv>) {
  const baseUrl = new URL(c.req.url).origin;
  
  return c.json({
    name: "WebLens MCP Server",
    version: "2.1.0",
    tagline: "Scrape, crawl, map and extract the web — pay per call",
    description: `Web Intelligence API for AI agents with x402 micropayments. No API keys, no accounts, no monthly minimum - just pay per request with USDC on ${supportedNetworkNames(c.env)}.`,
    protocolVersion: MCP_VERSION,
    transport: "streamable-http",
    capabilities: [
      "free-previews",
      "web-scraping",
      "javascript-rendering",
      "screenshot-capture",
      "web-search",
      "news-search",
      "image-search",
      "local-business-data",
      "shopping-search",
      "academic-search",
      "keyword-autocomplete",
      "trend-analysis",
      "youtube-transcripts",
      "grounded-answers",
      "deep-research",
      "cited-research",
      "bulk-page-contents",
      "site-mapping",
      "sitemap-discovery",
      "web-crawling",
      "data-extraction",
      "ai-powered-analysis",
      "pdf-extraction",
      "batch-operations",
      "web-intelligence",
    ],
    // Each tool exposes its REST endpoint and price as structured fields
    // (in addition to the natural-language description) so callers can
    // discover pricing programmatically without parsing the description.
    tools: TOOLS.map(t => {
      const ep = TOOL_ENDPOINTS[t.name];
      return {
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        ...(ep && { path: ep.endpoint, method: ep.method, price: ep.price }),
      };
    }),
    pricing: {
      currency: "USDC",
      networks: supportedNetworks(c.env),
      protocol: "x402",
      range: getPriceRange(),
      noFees: true,
      instantSettlement: true,
    },
    integration: {
      remote: `${baseUrl}/mcp`,
    },
    documentation: {
      interactive: `${baseUrl}/docs`,
      openapi: `${baseUrl}/openapi.json`,
      llms: `${baseUrl}/llms.txt`,
      discovery: `${baseUrl}/discovery`,
    },
    x402: {
      version: 2,
      facilitator: "payai+cdp",
      bazaarListed: false,
    },
  });
}
