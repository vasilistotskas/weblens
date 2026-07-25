/**
 * Search verticals, social data, contents, and answer routes.
 *
 * Every endpoint here follows validation → credit → payment → handler.
 * Prices come from PRICING.searchVerticals / contents / youtubeTranscript /
 * answer — all set above the worst-case upstream cost (see config.ts).
 */

import type { Context, Hono } from "hono";
import { PRICING } from "../config";
import { createCreditMiddleware } from "../middleware/credit-middleware";
import { createLazyPaymentMiddleware } from "../middleware/payment";
import { validateRequest } from "../middleware/validation";
import {
    VerticalSearchRequestSchema,
    PlacesSearchRequestSchema,
    TrendsRequestSchema,
    YoutubeTranscriptRequestSchema,
    ContentsRequestSchema,
    AnswerRequestSchema,
} from "../schemas";
import { parsePrice } from "../services/pricing";
import { answerHandler } from "../tools/answer";
import { contentsHandler } from "../tools/contents";
import {
    searchNewsHandler,
    searchImagesHandler,
    searchPlacesHandler,
    searchShoppingHandler,
    searchScholarHandler,
    searchAutocompleteHandler,
    searchTrendsHandler,
} from "../tools/search-verticals";
import { youtubeTranscriptHandler } from "../tools/youtube-transcript";
import type { Env, Variables } from "../types";

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const QUERY_INPUT = {
    properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results (default 10, max 20)", maximum: 20 },
    },
    required: ["query"],
} as const;

/** Register a {query, limit} vertical with static pricing. */
function registerQueryVertical(
    app: Hono<{ Bindings: Env; Variables: Variables }>,
    path: string,
    price: string,
    label: string,
    description: string,
    outputExample: Record<string, unknown>,
    outputSchema: Record<string, unknown>,
) {
    app.use(
        path,
        validateRequest(VerticalSearchRequestSchema),
        createCreditMiddleware(price, label),
        createLazyPaymentMiddleware(
            path,
            price,
            description,
            { query: "x402 payment protocol", limit: 10 },
            QUERY_INPUT,
            outputExample,
            outputSchema,
        ),
    );
}

export function registerVerticalRoutes(app: Hono<{ Bindings: Env; Variables: Variables }>) {
    // ============================================
    // /search/news
    // ============================================
    registerQueryVertical(
        app, "/search/news", PRICING.searchVerticals.news, "News Search",
        "Real-time news search via Google News. Returns ranked articles with source, date, and thumbnail.",
        {
            query: "artificial intelligence",
            results: [{ position: 1, title: "AI breakthrough announced", url: "https://news.example.com/ai", source: "Example News", date: "07/25/2026, 10:00 AM", isoDate: "2026-07-25T10:00:00Z" }],
            searchedAt: "2026-07-25T12:00:00.000Z",
            requestId: "req_news123",
        },
        {
            properties: {
                query: { type: "string" },
                results: { type: "array", description: "Articles with position, title, url, source, date, isoDate, thumbnail" },
                searchedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
    );
    app.post("/search/news", searchNewsHandler);

    // ============================================
    // /search/images
    // ============================================
    registerQueryVertical(
        app, "/search/images", PRICING.searchVerticals.images, "Image Search",
        "Google Images search. Returns direct image URLs with dimensions, thumbnails, and source pages.",
        {
            query: "golden gate bridge",
            results: [{ position: 1, title: "Golden Gate Bridge", imageUrl: "https://images.example.com/ggb.jpg", thumbnail: "https://t.example.com/ggb.jpg", sourcePage: "https://example.com/ggb", width: 1920, height: 1080 }],
            searchedAt: "2026-07-25T12:00:00.000Z",
            requestId: "req_img123",
        },
        {
            properties: {
                query: { type: "string" },
                results: { type: "array", description: "Images with position, title, imageUrl, thumbnail, sourcePage, source, width, height" },
                searchedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
    );
    app.post("/search/images", searchImagesHandler);

    // ============================================
    // /search/places — Google Local business data
    // ============================================
    app.use(
        "/search/places",
        validateRequest(PlacesSearchRequestSchema),
        createCreditMiddleware(PRICING.searchVerticals.places, "Places Search"),
        createLazyPaymentMiddleware(
            "/search/places",
            PRICING.searchVerticals.places,
            "Local business search via Google Local. Returns names, addresses, ratings, reviews, phone numbers, websites, and coordinates.",
            { query: "coffee shops", location: "Austin, Texas", limit: 10 },
            {
                properties: {
                    query: { type: "string", description: "What to search for" },
                    location: { type: "string", description: "Free-text location bias, e.g. \"Austin, Texas\"" },
                    limit: { type: "number", description: "Max results (default 10, max 20)", maximum: 20 },
                },
                required: ["query"],
            },
            {
                query: "coffee shops",
                location: "Austin, Texas",
                results: [{ position: 1, name: "Example Coffee", address: "123 Main St, Austin, TX", rating: 4.7, reviews: 812, phone: "(512) 555-0100", website: "https://examplecoffee.com", coordinates: { latitude: 30.26, longitude: -97.74 } }],
                searchedAt: "2026-07-25T12:00:00.000Z",
                requestId: "req_places123",
            },
            {
                properties: {
                    query: { type: "string" },
                    location: { type: "string" },
                    results: { type: "array", description: "Places with name, address, rating, reviews, priceLevel, category, phone, website, placeId, coordinates" },
                    searchedAt: { type: "string" },
                    requestId: { type: "string" },
                },
            },
        ),
    );
    app.post("/search/places", searchPlacesHandler);

    // ============================================
    // /search/shopping
    // ============================================
    registerQueryVertical(
        app, "/search/shopping", PRICING.searchVerticals.shopping, "Shopping Search",
        "Google Shopping product search. Returns products with prices, sellers, ratings, and links.",
        {
            query: "mechanical keyboard",
            results: [{ position: 1, title: "Mechanical Keyboard RGB", url: "https://shop.example.com/kb", price: "$89.99", extractedPrice: 89.99, source: "Example Store", rating: 4.5, reviews: 1200 }],
            searchedAt: "2026-07-25T12:00:00.000Z",
            requestId: "req_shop123",
        },
        {
            properties: {
                query: { type: "string" },
                results: { type: "array", description: "Products with position, title, url, price, extractedPrice, source, rating, reviews, thumbnail" },
                searchedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
    );
    app.post("/search/shopping", searchShoppingHandler);

    // ============================================
    // /search/scholar
    // ============================================
    registerQueryVertical(
        app, "/search/scholar", PRICING.searchVerticals.scholar, "Scholar Search",
        "Google Scholar academic search. Returns papers with snippets, publication info, and citation counts.",
        {
            query: "transformer attention mechanisms",
            results: [{ position: 1, title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762", snippet: "The dominant sequence transduction models...", publicationInfo: "A Vaswani, N Shazeer - NeurIPS, 2017", citedBy: 130000 }],
            searchedAt: "2026-07-25T12:00:00.000Z",
            requestId: "req_scholar123",
        },
        {
            properties: {
                query: { type: "string" },
                results: { type: "array", description: "Papers with position, title, url, snippet, publicationInfo, citedBy" },
                searchedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
    );
    app.post("/search/scholar", searchScholarHandler);

    // ============================================
    // /search/autocomplete
    // ============================================
    registerQueryVertical(
        app, "/search/autocomplete", PRICING.searchVerticals.autocomplete, "Autocomplete",
        "Google Autocomplete suggestions for a partial query. Useful for keyword research and intent discovery.",
        {
            query: "how to deploy cloudf",
            suggestions: ["how to deploy cloudflare workers", "how to deploy cloudflare pages"],
            searchedAt: "2026-07-25T12:00:00.000Z",
            requestId: "req_auto123",
        },
        {
            properties: {
                query: { type: "string" },
                suggestions: { type: "array", description: "Suggestion strings ranked by relevance" },
                searchedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
    );
    app.post("/search/autocomplete", searchAutocompleteHandler);

    // ============================================
    // /search/trends
    // ============================================
    app.use(
        "/search/trends",
        validateRequest(TrendsRequestSchema),
        createCreditMiddleware(PRICING.searchVerticals.trends, "Trends Search"),
        createLazyPaymentMiddleware(
            "/search/trends",
            PRICING.searchVerticals.trends,
            "Google Trends interest-over-time for a query. Returns a timeline of relative search interest.",
            { query: "cloudflare workers" },
            {
                properties: {
                    query: { type: "string", description: "Topic to get trend data for" },
                },
                required: ["query"],
            },
            {
                query: "cloudflare workers",
                timeline: [{ date: "Jul 20 - 26, 2026", timestamp: "1784908800", values: [{ query: "cloudflare workers", value: 87 }] }],
                searchedAt: "2026-07-25T12:00:00.000Z",
                requestId: "req_trends123",
            },
            {
                properties: {
                    query: { type: "string" },
                    timeline: { type: "array", description: "Interest-over-time points with date, timestamp, values[{query, value}]" },
                    searchedAt: { type: "string" },
                    requestId: { type: "string" },
                },
            },
        ),
    );
    app.post("/search/trends", searchTrendsHandler);

    // ============================================
    // /social/youtube/transcript
    // ============================================
    app.use(
        "/social/youtube/transcript",
        validateRequest(YoutubeTranscriptRequestSchema),
        createCreditMiddleware(PRICING.youtubeTranscript, "YouTube Transcript"),
        createLazyPaymentMiddleware(
            "/social/youtube/transcript",
            PRICING.youtubeTranscript,
            "Full transcript of any YouTube video with timestamps. Accepts a video ID or any YouTube URL.",
            { videoId: "dQw4w9WgXcQ" },
            {
                properties: {
                    videoId: { type: "string", description: "YouTube video ID or full video URL" },
                    lang: { type: "string", description: "Transcript language code (optional)" },
                },
                required: ["videoId"],
            },
            {
                videoId: "dQw4w9WgXcQ",
                segments: [{ startMs: 0, startTime: "0:00", text: "We're no strangers to love" }],
                fullText: "We're no strangers to love...",
                fetchedAt: "2026-07-25T12:00:00.000Z",
                requestId: "req_yt123",
            },
            {
                properties: {
                    videoId: { type: "string" },
                    segments: { type: "array", description: "Transcript segments with startMs, startTime, text" },
                    fullText: { type: "string", description: "All segments joined" },
                    fetchedAt: { type: "string" },
                    requestId: { type: "string" },
                },
            },
        ),
    );
    app.post("/social/youtube/transcript", youtubeTranscriptHandler);

    // ============================================
    // /contents — per-URL dynamic pricing
    // ============================================
    const contentsPrice = (c: AppContext): string => {
        const body = c.get("validatedBody") as { urls?: unknown[] } | undefined;
        const n = Array.isArray(body?.urls) ? body.urls.length : PRICING.contents.minUrls;
        return `$${(n * parsePrice(PRICING.contents.perUrl)).toFixed(3)}`;
    };
    app.use(
        "/contents",
        validateRequest(ContentsRequestSchema),
        createCreditMiddleware((c) => contentsPrice(c as AppContext), "Page Contents"),
        createLazyPaymentMiddleware(
            "/contents",
            (c) => Promise.resolve(contentsPrice(c)),
            "Cheap bulk page text: fetch 1-20 URLs and get clean markdown, truncated to a per-page cap. $0.002 per URL.",
            { urls: ["https://example.com/article"], maxChars: 20000 },
            {
                properties: {
                    urls: { type: "array", description: "1-20 URLs to fetch" },
                    maxChars: { type: "number", description: "Per-page content character cap (default 20000)" },
                    timeout: { type: "number", description: "Per-URL timeout in ms" },
                },
                required: ["urls"],
            },
            {
                results: [{ url: "https://example.com/article", status: "success", title: "Example Article", content: "# Article...", truncated: false }],
                summary: { total: 1, successful: 1, failed: 0 },
                fetchedAt: "2026-07-25T12:00:00.000Z",
                requestId: "req_contents123",
            },
            {
                properties: {
                    results: { type: "array", description: "Per-URL results with url, status, title, content, truncated, error" },
                    summary: { type: "object", description: "total, successful, failed counts" },
                    fetchedAt: { type: "string" },
                    requestId: { type: "string" },
                },
            },
        ),
    );
    app.post("/contents", contentsHandler);

    // ============================================
    // /answer — grounded answer with citations
    // ============================================
    app.use(
        "/answer",
        validateRequest(AnswerRequestSchema),
        createCreditMiddleware(PRICING.answer, "Grounded Answer"),
        createLazyPaymentMiddleware(
            "/answer",
            PRICING.answer,
            "Grounded answer with inline [n] citations: searches the web, fetches sources, and answers strictly from them.",
            { query: "What is the x402 payment protocol?", sources: 3 },
            {
                properties: {
                    query: { type: "string", description: "The question to answer" },
                    sources: { type: "number", description: "Web sources to search, fetch, and cite (default 3, max 5)", maximum: 5 },
                },
                required: ["query"],
            },
            {
                query: "What is the x402 payment protocol?",
                answer: "x402 is an open payment protocol built on HTTP 402 [1]. It settles USDC payments on Base [2].",
                citations: [{ index: 1, url: "https://x402.org", title: "x402 Protocol" }],
                confidence: 0.92,
                answeredAt: "2026-07-25T12:00:00.000Z",
                requestId: "req_answer123",
            },
            {
                properties: {
                    query: { type: "string" },
                    answer: { type: "string", description: "Answer text with inline [n] citation markers" },
                    citations: { type: "array", description: "Citation list with index, url, title" },
                    confidence: { type: "number" },
                    answeredAt: { type: "string" },
                    requestId: { type: "string" },
                },
            },
        ),
    );
    app.post("/answer", answerHandler);
}
