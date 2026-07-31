import { z } from "zod";
import { VIEWPORT_BOUNDS, TIMEOUT_CONFIG, PRICING } from "./config";

/**
 * WebLens API Schemas
 * Centralized Zod definitions for all endpoint request bodies.
 */

// Reusable primitives
const urlSchema = z.url().describe("The URL to process");
const timeoutSchema = z.number().min(TIMEOUT_CONFIG.min).max(TIMEOUT_CONFIG.max).optional().default(TIMEOUT_CONFIG.default);
const limitSchema = z.number().min(1).max(20).optional().default(10);

// ============================================
// Core Endpoints
// ============================================

export const FetchRequestSchema = z.object({
    url: urlSchema,
    timeout: timeoutSchema,
    cache: z.boolean().optional().default(true),
    cacheTtl: z.number().min(60).max(86400).optional().default(3600),
    waitFor: z.string().optional().describe("CSS selector to wait for (Pro tier only)"),
});

export const ScreenshotRequestSchema = z.object({
    url: urlSchema,
    width: z.number().min(VIEWPORT_BOUNDS.width.min).max(VIEWPORT_BOUNDS.width.max).optional().default(VIEWPORT_BOUNDS.width.default),
    height: z.number().min(VIEWPORT_BOUNDS.height.min).max(VIEWPORT_BOUNDS.height.max).optional().default(VIEWPORT_BOUNDS.height.default),
    fullPage: z.boolean().optional().default(false),
    selector: z.string().optional().describe("CSS selector to capture"),
    timeout: timeoutSchema,
});

export const SearchRequestSchema = z.object({
    query: z.string().min(1).max(500),
    limit: limitSchema,
    // Search-with-content: fetch the top-N result pages and include their
    // markdown in the response. Priced per fetched result on top of the
    // search base price.
    includeContent: z.boolean().optional().default(false),
    contentResults: z.number().min(1).max(10).optional().default(5)
        .describe("How many top results to fetch content for (when includeContent)"),
    contentChars: z.number().min(500).max(20000).optional().default(8000)
        .describe("Per-page content character cap"),
});

// Shared by /search/news, /search/images, /search/shopping, /search/scholar,
// /search/autocomplete — one SerpAPI call each.
export const VerticalSearchRequestSchema = z.object({
    query: z.string().min(1).max(500),
    limit: limitSchema,
});

export const PlacesSearchRequestSchema = z.object({
    query: z.string().min(1).max(500),
    location: z.string().min(2).max(200).optional()
        .describe("Free-text location bias, e.g. \"Austin, Texas\""),
    limit: limitSchema,
});

export const TrendsRequestSchema = z.object({
    query: z.string().min(1).max(500),
});

export const YoutubeTranscriptRequestSchema = z.object({
    videoId: z.string().min(5).max(200)
        .describe("YouTube video ID (e.g. dQw4w9WgXcQ) or full video URL"),
    lang: z.string().min(2).max(10).optional().describe("Transcript language code (default: video default)"),
});

export const ContentsRequestSchema = z.object({
    urls: z.array(urlSchema).min(1).max(20),
    maxChars: z.number().min(500).max(50000).optional().default(20000)
        .describe("Per-page content character cap"),
    timeout: timeoutSchema,
});

// Path filters are plain substrings (not regex) so a caller cannot supply a
// catastrophic-backtracking pattern.
const pathFilterSchema = z.array(z.string().min(1).max(200)).max(20).optional().default([]);

export const MapRequestSchema = z.object({
    url: urlSchema,
    limit: z.number().min(1).max(5000).optional().default(1000)
        .describe("Maximum URLs to return"),
    include: pathFilterSchema.describe("Only URLs whose path+query contains one of these"),
    exclude: pathFilterSchema.describe("Skip URLs whose path+query contains one of these"),
    timeout: timeoutSchema,
});

export const CrawlRequestSchema = z.object({
    url: urlSchema,
    limit: z.number().min(PRICING.crawl.minPages).max(PRICING.crawl.maxPages).optional().default(10)
        .describe("Page budget — you are charged per requested page"),
    maxDepth: z.number().min(0).max(3).optional().default(2)
        .describe("Link depth from the start URL (0 = start page only)"),
    include: pathFilterSchema.describe("Only crawl URLs whose path+query contains one of these"),
    exclude: pathFilterSchema.describe("Skip URLs whose path+query contains one of these"),
    respectRobots: z.boolean().optional().default(true)
        .describe("Honour robots.txt (default true; disable only for sites you control)"),
    maxChars: z.number().min(500).max(50000).optional().default(8000)
        .describe("Per-page content character cap"),
    timeout: timeoutSchema,
});

export const AnswerRequestSchema = z.object({
    query: z.string().min(1).max(500),
    sources: z.number().min(1).max(5).optional().default(3)
        .describe("How many web sources to search, fetch, and cite"),
});

export const ExtractRequestSchema = z.object({
    url: urlSchema,
    schema: z.record(z.string(), z.unknown()).describe("JSON schema for extraction"),
    instructions: z.string().optional().describe("Natural language extraction hints"),
});

// ============================================
// Advanced Endpoints
// ============================================

export const BatchFetchRequestSchema = z.object({
    urls: z.array(urlSchema).min(2).max(20),
    timeout: timeoutSchema,
    tier: z.enum(["basic", "pro"]).optional().default("basic"),
});

export const ResearchRequestSchema = z.object({
    query: z.string().min(1).max(500),
    resultCount: z.number().min(1).max(10).optional().default(5),
    includeRawContent: z.boolean().optional().default(false),
});

export const SmartExtractRequestSchema = z.object({
    url: urlSchema,
    query: z.string().min(1).max(500).describe("What to extract"),
    // The smart-extract AI service (src/services/ai.ts `smartExtract`) only
    // branches on "text" vs default JSON output — it cannot produce markdown.
    format: z.enum(["json", "text"]).optional().default("json"),
});

export const PdfRequestSchema = z.object({
    url: urlSchema,
    pages: z.array(z.number().min(1)).optional(),
});

export const CompareRequestSchema = z.object({
    urls: z.array(urlSchema).min(2).max(3),
    focus: z.string().optional().default("general"),
});

// ============================================
// System & Utility Endpoints
// ============================================

export const MonitorCreateRequestSchema = z.object({
    url: urlSchema,
    webhookUrl: urlSchema,
    checkInterval: z.number().min(1).max(24).optional().default(1),
    notifyOn: z.enum(["any", "content", "status"]).optional().default("any"),
});

export const MemorySetRequestSchema = z.object({
    key: z.string().min(1).max(256),
    value: z.unknown(),
    ttl: z.number().min(1).max(720).optional().default(168), // hours
});

export const CreditsBuyRequestSchema = z.object({
    amount: z.number().min(2).max(1000), // USD
});

// Fiat deposit via Stripe Checkout. `wallet` keys the credit account so a
// dev can buy credits with a card and then sign requests from that wallet.
export const FiatDepositRequestSchema = z.object({
    amount: z.number().min(2).max(1000),
    wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/u, "Must be a 0x-prefixed 40-hex address"),
});
