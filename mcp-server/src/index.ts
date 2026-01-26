#!/usr/bin/env node
/**
 * WebLens MCP Server
 * Exposes WebLens API tools to AI agents via Model Context Protocol
 * Handles x402 payments automatically using v2 API
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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

// Tool: Fetch webpage (basic)
server.tool(
  "fetch_webpage",
  "Fetch and convert a webpage to clean markdown. Fast, no JavaScript rendering.",
  {
    url: z.string().url().describe("The URL to fetch"),
    includeLinks: z.boolean().optional().describe("Include links in output"),
    includeImages: z.boolean().optional().describe("Include image references"),
  },
  async ({ url, includeLinks, includeImages }) => {
    const res = await client.post("/fetch/basic", {
      url,
      includeLinks: includeLinks ?? true,
      includeImages: includeImages ?? false,
    });
    return {
      content: [{ type: "text", text: res.data.content || res.data.markdown }],
    };
  }
);

// Tool: Fetch webpage with JS rendering (pro)
server.tool(
  "fetch_webpage_pro",
  "Fetch webpage with full JavaScript rendering. Use for SPAs and dynamic content.",
  {
    url: z.string().url().describe("The URL to fetch"),
    waitFor: z.number().optional().describe("Wait time in ms for JS to load"),
  },
  async ({ url, waitFor }) => {
    const res = await client.post("/fetch/pro", {
      url,
      waitFor: waitFor ?? 2000,
    });
    return {
      content: [{ type: "text", text: res.data.content || res.data.markdown }],
    };
  }
);

// Tool: Screenshot
server.tool(
  "screenshot",
  "Capture a screenshot of a webpage. Returns base64 PNG image.",
  {
    url: z.string().url().describe("The URL to screenshot"),
    width: z.number().optional().describe("Viewport width (default: 1280)"),
    height: z.number().optional().describe("Viewport height (default: 720)"),
    fullPage: z.boolean().optional().describe("Capture full page scroll"),
  },
  async ({ url, width, height, fullPage }) => {
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
          data: res.data.image,
          mimeType: "image/png",
        },
      ],
    };
  }
);

// Tool: Web search
server.tool(
  "search_web",
  "Search the web and get real-time results with snippets.",
  {
    query: z.string().describe("Search query"),
    limit: z.number().optional().describe("Number of results (default: 10)"),
  },
  async ({ query, limit }) => {
    const res = await client.post("/search", {
      query,
      limit: limit ?? 10,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(res.data.results, null, 2) }],
    };
  }
);

// Tool: Extract structured data
server.tool(
  "extract_data",
  "Extract structured data from a webpage using CSS selectors.",
  {
    url: z.string().url().describe("The URL to extract from"),
    selectors: z.record(z.string(), z.string()).describe("Map of field names to CSS selectors"),
  },
  async ({ url, selectors }) => {
    const res = await client.post("/extract", { url, selectors });
    return {
      content: [{ type: "text", text: JSON.stringify(res.data.data, null, 2) }],
    };
  }
);

// Tool: Smart extract (AI-powered)
server.tool(
  "smart_extract",
  "Extract data using natural language. AI understands what you want.",
  {
    url: z.string().url().describe("The URL to extract from"),
    query: z.string().describe("What data to extract (natural language)"),
  },
  async ({ url, query }) => {
    const res = await client.post("/extract/smart", { url, query });
    return {
      content: [{ type: "text", text: JSON.stringify(res.data.data, null, 2) }],
    };
  }
);

// Tool: Research
server.tool(
  "research",
  "One-stop research: searches web, fetches top results, and summarizes findings.",
  {
    query: z.string().describe("Research topic or question"),
    resultCount: z.number().optional().describe("Number of sources to analyze (default: 5)"),
  },
  async ({ query, resultCount }) => {
    const res = await client.post("/research", {
      query,
      resultCount: resultCount ?? 5,
    });
    return {
      content: [{ type: "text", text: res.data.summary }],
    };
  }
);

// Tool: PDF extraction
server.tool(
  "extract_pdf",
  "Extract text and metadata from a PDF document.",
  {
    url: z.string().url().describe("URL of the PDF to extract"),
  },
  async ({ url }) => {
    const res = await client.post("/pdf", { url });
    return {
      content: [{ type: "text", text: res.data.fullText }],
    };
  }
);

// Tool: Compare URLs
server.tool(
  "compare_urls",
  "Compare 2-3 webpages and get AI-generated analysis of differences.",
  {
    urls: z.array(z.string().url()).min(2).max(3).describe("URLs to compare"),
    focus: z.string().optional().describe("What to focus comparison on"),
  },
  async ({ urls, focus }) => {
    const res = await client.post("/compare", { urls, focus });
    return {
      content: [{ type: "text", text: res.data.comparison.summary }],
    };
  }
);

// Tool: Batch fetch
server.tool(
  "batch_fetch",
  "Fetch multiple URLs in parallel. Efficient for bulk operations.",
  {
    urls: z.array(z.string().url()).min(2).max(20).describe("URLs to fetch"),
  },
  async ({ urls }) => {
    const res = await client.post("/batch/fetch", { urls });
    return {
      content: [{ type: "text", text: JSON.stringify(res.data.results, null, 2) }],
    };
  }
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

main().catch(console.error);
