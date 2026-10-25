import { z } from "zod";
import {
    CACHE_TTL_SECONDS,
    CREDIT_PACKS,
    DEEP_RESEARCH_DEFAULT_DEPTH,
    DEEP_RESEARCH_DEPTHS,
    describeDeepResearchTiers,
    PRICING,
    SEARCH_CONTENT_RESULTS,
    TIMEOUT_CONFIG,
    VIEWPORT_BOUNDS,
} from "./config";
import { MAX_DOCUMENT_DEPTH, exceedsDepth } from "./utils/json-document";

/**
 * WebLens API Schemas
 * Centralized Zod definitions for all endpoint request bodies.
 */

// Reusable primitives
const urlSchema = z.url().describe("The URL to process");
const timeoutSchema = z.number().min(TIMEOUT_CONFIG.min).max(TIMEOUT_CONFIG.max).optional().default(TIMEOUT_CONFIG.default)
    .describe("Request timeout in milliseconds");
const limitSchema = z.number().min(1).max(20).optional().default(10).describe("Maximum results to return");
const searchQuerySchema = z.string().min(1).max(500).describe("Search query");

/**
 * Response-cache controls for endpoints with a registry cacheKey. The cache
 * middleware reads them from the raw body, before validation, and clamps the
 * TTL to the same CACHE_TTL_SECONDS bounds.
 */
const cacheOptions = {
    cache: z.boolean().optional().default(true)
        .describe(`Serve a cached copy when one exists (cached responses are ${String(Math.round(PRICING.cacheDiscount * 100))}% off)`),
    cacheTtl: z.number().min(CACHE_TTL_SECONDS.min).max(CACHE_TTL_SECONDS.max).optional().default(CACHE_TTL_SECONDS.default)
        .describe("How long to cache this response, in seconds"),
};

// ============================================
// Core Endpoints
// ============================================

export const FetchRequestSchema = z.object({
    url: urlSchema,
    timeout: timeoutSchema,
    ...cacheOptions,
    waitFor: z.string().optional().describe("CSS selector to wait for (Pro tier only)"),
});

export const ScreenshotRequestSchema = z.object({
    url: urlSchema,
    width: z.number().min(VIEWPORT_BOUNDS.width.min).max(VIEWPORT_BOUNDS.width.max).optional().default(VIEWPORT_BOUNDS.width.default)
        .describe("Viewport width in pixels"),
    height: z.number().min(VIEWPORT_BOUNDS.height.min).max(VIEWPORT_BOUNDS.height.max).optional().default(VIEWPORT_BOUNDS.height.default)
        .describe("Viewport height in pixels"),
    fullPage: z.boolean().optional().default(false).describe("Capture the whole scrollable page, not just the viewport"),
    selector: z.string().optional().describe("CSS selector to capture"),
    timeout: timeoutSchema,
});

export const SearchRequestSchema = z.object({
    query: searchQuerySchema,
    limit: limitSchema,
    // Search-with-content: fetch the top-N result pages and include their
    // markdown in the response. Priced per fetched result on top of the
    // search base price.
    includeContent: z.boolean().optional().default(false)
        .describe(`Also fetch the top result pages as markdown (+${PRICING.contents.perUrl} per fetched result)`),
    contentResults: z.number().min(SEARCH_CONTENT_RESULTS.min).max(SEARCH_CONTENT_RESULTS.max).optional().default(SEARCH_CONTENT_RESULTS.default)
        .describe("How many top results to fetch content for (when includeContent)"),
    contentChars: z.number().min(500).max(20000).optional().default(8000)
        .describe("Per-page content character cap"),
});

// Shared by /search/news, /search/images, /search/shopping, /search/scholar,
// /search/autocomplete — one Serper call each.
export const VerticalSearchRequestSchema = z.object({
    query: searchQuerySchema,
    limit: limitSchema,
});

export const PlacesSearchRequestSchema = z.object({
    query: z.string().min(1).max(500).describe("What to search for, e.g. \"coffee shops\""),
    location: z.string().min(2).max(200).optional()
        .describe("Free-text location bias, e.g. \"Austin, Texas\""),
    limit: limitSchema,
});

export const TrendsRequestSchema = z.object({
    query: z.string().min(1).max(500).describe("Topic to get trend data for"),
});

export const YoutubeTranscriptRequestSchema = z.object({
    videoId: z.string().min(5).max(200)
        .describe("YouTube video ID (e.g. dQw4w9WgXcQ) or full video URL"),
    lang: z.string().min(2).max(10).optional().describe("Transcript language code (default: video default)"),
});

export const ContentsRequestSchema = z.object({
    urls: z.array(urlSchema).min(PRICING.contents.minUrls).max(PRICING.contents.maxUrls).describe("Pages to fetch"),
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
    limit: z.number().min(PRICING.crawl.minPages).max(PRICING.crawl.maxPages).optional().default(PRICING.crawl.defaultPages)
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

export const PreviewRequestSchema = z.object({
    endpoint: z.string().min(1).max(100)
        .describe("Paid endpoint path to preview, e.g. \"/answer\""),
    url: urlSchema.optional()
        .describe("For fetch-backed endpoints only: run a real truncated preview of this URL"),
    domain: z.string().min(3).max(253).optional()
        .describe("For /domain only: run a real, summarised preview of this domain"),
});

/**
 * ERC-8004 feedback document (POST /feedback).
 *
 * The document is buyer-authored and hosted verbatim, so this must be the one
 * schema in the app that PRESERVES unknown keys — stripping them would change
 * the bytes we hash. It still has to be a JSON object (not null, not an
 * array) and shallow enough for `canonicalJson` to hash without exhausting
 * the stack. Required-field presence is reported field-by-field in the
 * handler; see REQUIRED_FEEDBACK_FIELDS.
 */
export const FeedbackDocumentSchema = z.looseObject({}).refine(
    (document) => !exceedsDepth(document),
    { message: `Document nesting exceeds the ${String(MAX_DOCUMENT_DEPTH)} level limit` },
);

export const ProjectAuditRequestSchema = z.object({
    domain: z.string().min(3).max(253)
        .describe("Project website, e.g. \"example.org\". A full URL is reduced to its hostname."),
    tokenAddress: z.string().min(20).max(80).optional()
        .describe("Optional contract/token address to cross-check against the addresses printed on the site"),
    chain: z.string().min(2).max(32).optional()
        .describe("Optional chain label for the token address, e.g. \"base\", \"ethereum\", \"solana\""),
});

export const PackageRequestSchema = z.object({
    name: z.string().min(1).max(214)
        .describe("Package name, e.g. \"express\" or \"@scope/pkg\" (npm), \"requests\" (PyPI)"),
    registry: z.enum(["npm", "pypi"]).optional().default("npm")
        .describe("Which registry to look in (default npm)"),
});

export const TechRequestSchema = z.object({
    url: urlSchema.describe("Site URL to fingerprint"),
});

export const DiscussionsRequestSchema = z.object({
    query: z.string().min(1).max(200).describe("What to search Hacker News for"),
    limit: z.number().min(1).max(50).optional().default(10)
        .describe("Stories to return (1-50, default 10)"),
    sort: z.enum(["relevance", "recent"]).optional().default("relevance")
        .describe("Rank by relevance (default) or newest first"),
});

export const DomainRequestSchema = z.object({
    domain: z.string().min(3).max(253)
        .describe("Domain to inspect, e.g. \"stripe.com\". A full URL is accepted and reduced to its hostname."),
});

export const CompanyRequestSchema = z.object({
    domain: DomainRequestSchema.shape.domain
        .describe("The company's website domain, e.g. \"vercel.com\". A full URL is accepted and reduced to its hostname."),
    ...cacheOptions,
});

export const DeepResearchRequestSchema = z.object({
    query: z.string().min(1).max(500).describe("The research question"),
    depth: z.enum(DEEP_RESEARCH_DEPTHS).optional().default(DEEP_RESEARCH_DEFAULT_DEPTH)
        .describe(describeDeepResearchTiers()),
});

export const AnswerRequestSchema = z.object({
    query: z.string().min(1).max(500).describe("The question to answer"),
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

export const PdfRequestSchema = z.object({
    url: urlSchema,
    pages: z.array(z.number().min(1)).optional().describe("Page numbers to extract (omit for every page)"),
});

// ============================================
// System & Utility Endpoints
// ============================================

// Asking to hear when card payments launch (POST /billing/waitlist), where they are not live yet.
export const WaitlistRequestSchema = z.object({
    email: z.email().max(254).describe("Address for the one email sent when card payments launch"),
    pack: z.enum(CREDIT_PACKS).optional().describe(`Pack you would buy: ${CREDIT_PACKS.map((pack) => pack).join(", ")}`),
});

// A prepaid pack bought by card (POST /billing/checkout).
export const CheckoutRequestSchema = z.object({
    pack: z.enum(CREDIT_PACKS).describe(`Pack to buy, in USD at face value: ${CREDIT_PACKS.map((pack) => `$${pack}`).join(", ")}`),
});
