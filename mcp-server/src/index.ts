#!/usr/bin/env node
/**
 * WebLens MCP Server
 * Exposes WebLens API tools to AI agents via Model Context Protocol
 * Handles x402 payments automatically using v2 API
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { x402Client, wrapAxiosWithPayment } from "@x402/axios";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import axios, { AxiosInstance } from "axios";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod/v4";

// Configuration from environment
const WEBLENS_URL = process.env.WEBLENS_URL || "https://api.weblens.dev";
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;

if (!PRIVATE_KEY) {
  console.error("Error: PRIVATE_KEY environment variable is required");
  console.error("Set it to your wallet private key (with USDC on Base)");
  process.exit(1);
}

// Client will be initialized async
let client: AxiosInstance;

async function initClient() {
  // Create account from private key
  const account = privateKeyToAccount(PRIVATE_KEY);

  // Create x402 client and register EVM scheme
  const x402 = new x402Client();
  registerExactEvmScheme(x402, { signer: account });

  // Create axios client with x402 payment handling
  client = wrapAxiosWithPayment(
    axios.create({ baseURL: WEBLENS_URL }),
    x402
  );
}

// Create MCP server
const server = new McpServer({
  name: "weblens",
  version: "2.0.0",
});

/** Build a clear, single-line error message from an unknown thrown value. */
function describeError(error: unknown, action: string): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const apiMessage =
      (error.response?.data as { error?: string; message?: string } | undefined)
        ?.message ??
      (error.response?.data as { error?: string } | undefined)?.error;
    const statusPart = status ? ` (HTTP ${status})` : "";
    return `Failed to ${action}${statusPart}: ${apiMessage ?? error.message}`;
  }
  return `Failed to ${action}: ${error instanceof Error ? error.message : String(error)}`;
}

/** Wrap a tool body so all errors return an isError CallToolResult. */
async function runTool(
  action: string,
  body: () => Promise<CallToolResult>
): Promise<CallToolResult> {
  try {
    return await body();
  } catch (error) {
    return {
      content: [{ type: "text", text: describeError(error, action) }],
      isError: true,
    };
  }
}

/** Require a field on the response payload; throw a clear error if missing. */
function requireField<T>(value: T | undefined | null, field: string): T {
  if (value === undefined || value === null) {
    throw new Error(`Unexpected API response: missing field "${field}"`);
  }
  return value;
}

// Tool: Fetch webpage (basic)
server.registerTool(
  "fetch_webpage",
  {
    description:
      "Fetch and convert a webpage to clean markdown. Fast, no JavaScript rendering.",
    inputSchema: z.object({
      url: z.string().url().describe("The URL to fetch"),
      includeLinks: z.boolean().optional().describe("Include links in output"),
      includeImages: z
        .boolean()
        .optional()
        .describe("Include image references"),
    }),
  },
  async ({ url, includeLinks, includeImages }) =>
    runTool("fetch webpage", async () => {
      const res = await client.post("/fetch/basic", {
        url,
        includeLinks: includeLinks ?? true,
        includeImages: includeImages ?? false,
      });
      const text = res.data?.content ?? res.data?.markdown;
      return {
        content: [{ type: "text", text: requireField(text, "content") }],
      };
    })
);

// Tool: Fetch webpage with JS rendering (pro)
server.registerTool(
  "fetch_webpage_pro",
  {
    description:
      "Fetch webpage with full JavaScript rendering. Use for SPAs and dynamic content.",
    inputSchema: z.object({
      url: z.string().url().describe("The URL to fetch"),
      waitFor: z.number().optional().describe("Wait time in ms for JS to load"),
    }),
  },
  async ({ url, waitFor }) =>
    runTool("fetch webpage (pro)", async () => {
      const res = await client.post("/fetch/pro", {
        url,
        waitFor: waitFor ?? 2000,
      });
      const text = res.data?.content ?? res.data?.markdown;
      return {
        content: [{ type: "text", text: requireField(text, "content") }],
      };
    })
);

// Tool: Screenshot
server.registerTool(
  "screenshot",
  {
    description:
      "Capture a screenshot of a webpage. Returns base64 PNG image.",
    inputSchema: z.object({
      url: z.string().url().describe("The URL to screenshot"),
      width: z.number().optional().describe("Viewport width (default: 1280)"),
      height: z.number().optional().describe("Viewport height (default: 720)"),
      fullPage: z.boolean().optional().describe("Capture full page scroll"),
    }),
  },
  async ({ url, width, height, fullPage }) =>
    runTool("capture screenshot", async () => {
      const res = await client.post("/screenshot", {
        url,
        width: width ?? 1280,
        height: height ?? 720,
        fullPage: fullPage ?? false,
      });
      return {
        content: [
          {
            type: "image",
            data: requireField(res.data?.image, "image"),
            mimeType: "image/png",
          },
        ],
      };
    })
);

// Tool: Web search
server.registerTool(
  "search_web",
  {
    description: "Search the web and get real-time results with snippets.",
    inputSchema: z.object({
      query: z.string().describe("Search query"),
      limit: z.number().optional().describe("Number of results (default: 10)"),
    }),
  },
  async ({ query, limit }) =>
    runTool("search the web", async () => {
      const res = await client.post("/search", {
        query,
        limit: limit ?? 10,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              requireField(res.data?.results, "results"),
              null,
              2
            ),
          },
        ],
      };
    })
);

// Tool: Extract structured data
server.registerTool(
  "extract_data",
  {
    description: "Extract structured data from a webpage using CSS selectors.",
    inputSchema: z.object({
      url: z.string().url().describe("The URL to extract from"),
      selectors: z
        .record(z.string(), z.string())
        .describe("Map of field names to CSS selectors"),
    }),
  },
  async ({ url, selectors }) =>
    runTool("extract data", async () => {
      const res = await client.post("/extract", { url, selectors });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(requireField(res.data?.data, "data"), null, 2),
          },
        ],
      };
    })
);

// Tool: Smart extract (AI-powered)
server.registerTool(
  "smart_extract",
  {
    description:
      "Extract data using natural language. AI understands what you want.",
    inputSchema: z.object({
      url: z.string().url().describe("The URL to extract from"),
      query: z.string().describe("What data to extract (natural language)"),
    }),
  },
  async ({ url, query }) =>
    runTool("smart extract data", async () => {
      const res = await client.post("/extract/smart", { url, query });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(requireField(res.data?.data, "data"), null, 2),
          },
        ],
      };
    })
);

// Tool: Research
server.registerTool(
  "research",
  {
    description:
      "One-stop research: searches web, fetches top results, and summarizes findings.",
    inputSchema: z.object({
      query: z.string().describe("Research topic or question"),
      resultCount: z
        .number()
        .optional()
        .describe("Number of sources to analyze (default: 5)"),
    }),
  },
  async ({ query, resultCount }) =>
    runTool("perform research", async () => {
      const res = await client.post("/research", {
        query,
        resultCount: resultCount ?? 5,
      });
      return {
        content: [
          { type: "text", text: requireField(res.data?.summary, "summary") },
        ],
      };
    })
);

// Tool: PDF extraction
server.registerTool(
  "extract_pdf",
  {
    description: "Extract text and metadata from a PDF document.",
    inputSchema: z.object({
      url: z.string().url().describe("URL of the PDF to extract"),
    }),
  },
  async ({ url }) =>
    runTool("extract PDF", async () => {
      const res = await client.post("/pdf", { url });
      return {
        content: [
          { type: "text", text: requireField(res.data?.fullText, "fullText") },
        ],
      };
    })
);

// Tool: Compare URLs
server.registerTool(
  "compare_urls",
  {
    description:
      "Compare 2-3 webpages and get AI-generated analysis of differences.",
    inputSchema: z.object({
      urls: z
        .array(z.string().url())
        .min(2)
        .max(3)
        .describe("URLs to compare"),
      focus: z.string().optional().describe("What to focus comparison on"),
    }),
  },
  async ({ urls, focus }) =>
    runTool("compare URLs", async () => {
      const res = await client.post("/compare", { urls, focus });
      const summary = res.data?.comparison?.summary;
      return {
        content: [
          { type: "text", text: requireField(summary, "comparison.summary") },
        ],
      };
    })
);

// Tool: Batch fetch
server.registerTool(
  "batch_fetch",
  {
    description: "Fetch multiple URLs in parallel. Efficient for bulk operations.",
    inputSchema: z.object({
      urls: z.array(z.string().url()).min(2).max(20).describe("URLs to fetch"),
    }),
  },
  async ({ urls }) =>
    runTool("batch fetch URLs", async () => {
      const res = await client.post("/batch/fetch", { urls });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              requireField(res.data?.results, "results"),
              null,
              2
            ),
          },
        ],
      };
    })
);

// Start server
async function main() {
  // Initialize x402 payment client
  await initClient();
  console.error("WebLens MCP server: x402 v2 client initialized");

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("WebLens MCP server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
