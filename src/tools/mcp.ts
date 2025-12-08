/**
 * MCP (Model Context Protocol) HTTP Endpoint
 * Allows AI agents to connect via HTTP transport
 * 
 * Supports Streamable HTTP transport as per MCP spec
 */

import type { Context } from "hono";
import { PRICING } from "../config";
import type { Env } from "../types";

// MCP Protocol version
const MCP_VERSION = "2025-03-26";

// Tool definitions for WebLens
const TOOLS = [
  {
    name: "fetch_webpage",
    description: "Fetch and convert a webpage to clean markdown. Fast, no JavaScript rendering. Price: $0.005",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch" },
        includeLinks: { type: "boolean", description: "Include links in output" },
        includeImages: { type: "boolean", description: "Include image references" },
      },
      required: ["url"],
    },
  },
  {
    name: "fetch_webpage_pro",
    description: "Fetch webpage with full JavaScript rendering. Use for SPAs and dynamic content. Price: $0.015",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch" },
        waitFor: { type: "number", description: "Wait time in ms for JS to load" },
      },
      required: ["url"],
    },
  },
  {
    name: "screenshot",
    description: "Capture a screenshot of a webpage. Returns base64 PNG image. Price: $0.02",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to screenshot" },
        width: { type: "number", description: "Viewport width (default: 1280)" },
        height: { type: "number", description: "Viewport height (default: 720)" },
        fullPage: { type: "boolean", description: "Capture full page scroll" },
      },
      required: ["url"],
    },
  },

  {
    name: "search_web",
    description: "Search the web and get real-time results with snippets. Price: $0.005",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Number of results (default: 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "extract_data",
    description: "Extract structured data from a webpage using CSS selectors. Price: $0.03",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to extract from" },
        selectors: { type: "object", description: "Map of field names to CSS selectors" },
      },
      required: ["url", "selectors"],
    },
  },
  {
    name: "smart_extract",
    description: "Extract data using natural language. AI understands what you want. Price: $0.035",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to extract from" },
        query: { type: "string", description: "What data to extract (natural language)" },
      },
      required: ["url", "query"],
    },
  },
  {
    name: "research",
    description: "One-stop research: searches web, fetches top results, and summarizes findings. Price: $0.08",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Research topic or question" },
        resultCount: { type: "number", description: "Number of sources to analyze (default: 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "extract_pdf",
    description: "Extract text and metadata from a PDF document. Price: $0.01",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL of the PDF to extract" },
      },
      required: ["url"],
    },
  },
  {
    name: "compare_urls",
    description: "Compare 2-3 webpages and get AI-generated analysis of differences. Price: $0.05",
    inputSchema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" }, description: "URLs to compare (2-3)" },
        focus: { type: "string", description: "What to focus comparison on" },
      },
      required: ["urls"],
    },
  },
  {
    name: "batch_fetch",
    description: "Fetch multiple URLs in parallel. Efficient for bulk operations. Price: $0.003/URL",
    inputSchema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" }, description: "URLs to fetch (2-20)" },
      },
      required: ["urls"],
    },
  },
];

// Server info
const SERVER_INFO = {
  name: "weblens",
  version: "2.0.0",
  protocolVersion: MCP_VERSION,
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

async function handleJsonRpc(request: JsonRpcRequest, c: Context<{ Bindings: Env }>): Promise<JsonRpcResponse> {
  const { method, id } = request;
  const params = request.params;

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          ...SERVER_INFO,
          capabilities: SERVER_CAPABILITIES,
        },
      };

    case "initialized":
      return null;

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

async function handleToolCall(params: ToolCallParams, id: string | number | undefined, c: Context<{ Bindings: Env }>): Promise<JsonRpcResponse> {
  const { name, arguments: args } = params;
  const xPaymentHeader = c.req.header("X-PAYMENT");

  const toolEndpoints: Partial<Record<string, { endpoint: string; method: string; price: string }>> = {
    fetch_webpage: { endpoint: "/fetch/basic", method: "POST", price: PRICING.fetch.basic },
    fetch_webpage_pro: { endpoint: "/fetch/pro", method: "POST", price: PRICING.fetch.pro },
    screenshot: { endpoint: "/screenshot", method: "POST", price: PRICING.screenshot },
    search_web: { endpoint: "/search", method: "POST", price: PRICING.search },
    extract_data: { endpoint: "/extract", method: "POST", price: PRICING.extract },
    smart_extract: { endpoint: "/extract/smart", method: "POST", price: PRICING.smartExtract },
    research: { endpoint: "/research", method: "POST", price: PRICING.research },
    extract_pdf: { endpoint: "/pdf", method: "POST", price: PRICING.pdf },
    compare_urls: { endpoint: "/compare", method: "POST", price: PRICING.compare },
    batch_fetch: { endpoint: "/batch/fetch", method: "POST", price: "$0.006" },
  };

  const toolConfig = toolEndpoints[name];
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

  const baseUrl = new URL(c.req.url).origin;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(xPaymentHeader && { "X-PAYMENT": xPaymentHeader }),
  };

  try {
    const response = await fetch(`${baseUrl}${toolConfig.endpoint}`, {
      method: toolConfig.method,
      headers,
      body: JSON.stringify(args),
    });

    if (response.status === 402) {
      const paymentInfo: unknown = await response.json();
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: 402,
          message: "Payment Required",
          data: paymentInfo,
        },
      };
    }

    if (!response.ok) {
      const errorText = await response.text();
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: response.status,
          message: errorText,
        },
      };
    }

    const result: unknown = await response.json();
    const xPaymentResponse = response.headers.get("X-PAYMENT-RESPONSE");

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
        ...(xPaymentResponse && { _meta: { "x402/payment-response": xPaymentResponse } }),
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
export async function mcpPostHandler(c: Context<{ Bindings: Env }>) {
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
 * MCP HTTP GET handler (for SSE streams - not implemented yet)
 */
export function mcpGetHandler() {
  return new Response("Method Not Allowed", { 
    status: 405,
    headers: {
      "Allow": "POST",
    },
  });
}

/**
 * MCP info endpoint
 */
export function mcpInfoHandler(c: Context<{ Bindings: Env }>) {
  const baseUrl = new URL(c.req.url).origin;
  
  return c.json({
    name: "WebLens MCP Server",
    version: "2.0.0",
    tagline: "Give your AI agents web superpowers",
    description: "Web Intelligence API for AI agents with x402 micropayments. No API keys, no accounts - just pay per request with USDC on Base.",
    protocolVersion: MCP_VERSION,
    transport: "streamable-http",
    capabilities: [
      "web-scraping",
      "javascript-rendering",
      "screenshot-capture",
      "web-search",
      "data-extraction",
      "ai-powered-analysis",
      "pdf-extraction",
      "batch-operations",
    ],
    tools: TOOLS.map(t => ({ 
      name: t.name, 
      description: t.description,
      inputSchema: t.inputSchema,
    })),
    pricing: {
      currency: "USDC",
      network: "base",
      protocol: "x402",
      range: "$0.003 - $0.08 per request",
      noFees: true,
      instantSettlement: true,
    },
    integration: {
      remote: `${baseUrl}/mcp`,
      local: "npx -y weblens-mcp",
    },
    documentation: {
      interactive: `${baseUrl}/docs`,
      openapi: `${baseUrl}/openapi.json`,
      llms: `${baseUrl}/llms.txt`,
      discovery: `${baseUrl}/discovery`,
    },
    x402: {
      version: 1,
      facilitator: "CDP",
      bazaarListed: true,
    },
  });
}
