import { ActionProvider, X402ActionProvider } from "@coinbase/agentkit";
import type { Action, WalletProvider, Network } from "@coinbase/agentkit";
import { z } from "zod/v3";

// Schema definitions for each action
const fetchPageSchema = z.object({
    url: z.string().url().describe("The URL of the webpage to fetch"),
    includeLinks: z.boolean().optional().describe("Whether to include links in the output (default: true)"),
});

const extractDataSchema = z.object({
    url: z.string().url().describe("The URL to extract data from"),
    instruction: z.string().describe("Natural language instruction or description of data to extract"),
});

const searchWebSchema = z.object({
    query: z.string().describe("The search query"),
    limit: z.number().optional().describe("Number of results to return (default: 5)"),
});

const weatherSchema = z.object({
    location: z.string().describe("The city or coordinates"),
});

const financeSchema = z.object({
    symbol: z.string().describe("The ticker symbol (e.g., AAPL, BTC)"),
});

/**
 * WebLens Action Provider
 *
 * Exposes WebLens capabilities (Fetch, Extract, Search) as high-level actions
 * that automatically handle x402 micropayments via Coinbase AgentKit.
 */
export class WebLensActionProvider extends ActionProvider {
    private x402Provider: X402ActionProvider;
    private baseUrl: string;

    constructor(baseUrl: string = "https://api.weblens.dev") {
        super("weblens-action-provider", []);
        this.x402Provider = new X402ActionProvider();
        this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
    }

    supportsNetwork(network: Network): boolean {
        return this.x402Provider.supportsNetwork(network);
    }

    getActions(walletProvider: WalletProvider): Action[] {
        const makeRequest = (walletProvider: WalletProvider, endpoint: string, body: Record<string, unknown>) =>
            this.x402Provider.makeHttpRequestWithX402(walletProvider, {
                url: endpoint,
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body,
            });

        return [
            {
                name: "weblens_fetch_page",
                description: "Fetches the content of a webpage, handling any required payments automatically. Returns clean markdown.",
                schema: fetchPageSchema,
                invoke: async (args: z.infer<typeof fetchPageSchema>) =>
                    makeRequest(walletProvider, `${this.baseUrl}/fetch/basic`, {
                        url: args.url,
                        includeLinks: args.includeLinks ?? true,
                    }),
            },
            {
                name: "weblens_extract_data",
                description: "Extracts structured data from a webpage using JSON schema or selectors. Handles payments automatically.",
                schema: extractDataSchema,
                invoke: async (args: z.infer<typeof extractDataSchema>) =>
                    makeRequest(walletProvider, `${this.baseUrl}/extract/smart`, {
                        url: args.url,
                        query: args.instruction,
                    }),
            },
            {
                name: "weblens_search_web",
                description: "Searches the web for real-time information. Returns ranked results with snippets.",
                schema: searchWebSchema,
                invoke: async (args: z.infer<typeof searchWebSchema>) =>
                    makeRequest(walletProvider, `${this.baseUrl}/search`, {
                        query: args.query,
                        limit: args.limit ?? 5,
                    }),
            },
            {
                name: "weblens_get_weather",
                description: "Gets real-time verified weather data for a location.",
                schema: weatherSchema,
                invoke: async (args: z.infer<typeof weatherSchema>) =>
                    makeRequest(walletProvider, `${this.baseUrl}/search`, {
                        query: `current weather in ${args.location}`,
                        limit: 1,
                    }),
            },
            {
                name: "weblens_get_finance",
                description: "Gets real-time financial data (stock price, crypto price, market cap).",
                schema: financeSchema,
                invoke: async (args: z.infer<typeof financeSchema>) =>
                    makeRequest(walletProvider, `${this.baseUrl}/search`, {
                        query: `current price of ${args.symbol}`,
                        limit: 1,
                    }),
            },
        ] as unknown as Action[];
    }
}

export const webLensActionProvider = () => new WebLensActionProvider();
