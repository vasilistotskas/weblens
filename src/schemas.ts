import { z } from "zod";
import { VIEWPORT_BOUNDS, TIMEOUT_CONFIG } from "./config";

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
});

export const ExtractRequestSchema = z.object({
    url: urlSchema,
    schema: z.record(z.string(), z.any()).describe("JSON schema for extraction"),
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
    format: z.enum(["json", "text", "markdown"]).optional().default("json"),
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
    key: z.string().min(1).max(128),
    value: z.any(),
    ttl: z.number().min(1).max(720).optional().default(168), // hours
});

export const MemoryGetRequestSchema = z.object({
    key: z.string().min(1).max(128),
});

export const CreditsBuyRequestSchema = z.object({
    amount: z.number().min(5).max(1000), // USD
});

export const IntelRequestSchema = z.object({
    param: z.string().min(1), // symbol, domain, or query depending on endpoint
    depth: z.enum(["basic", "deep"]).optional().default("basic"),
});

export type FetchRequest = z.infer<typeof FetchRequestSchema>;
export type ScreenshotRequest = z.infer<typeof ScreenshotRequestSchema>;
export type SearchRequest = z.infer<typeof SearchRequestSchema>;
export type ExtractRequest = z.infer<typeof ExtractRequestSchema>;
