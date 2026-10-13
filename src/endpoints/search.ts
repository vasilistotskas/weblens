/**
 * Search endpoints: web search and its verticals and the answer and research
 * products built on it (each search is a paid upstream call), plus Hacker
 * News discussions (a free upstream).
 */

import {
    DEEP_RESEARCH_DEFAULT_DEPTH,
    describeDeepResearchTiers,
    PRICING,
    SEARCH_CONTENT_RESULTS,
} from "../config";
import type { DeepResearchDepth } from "../config";
import {
    AnswerRequestSchema,
    DeepResearchRequestSchema,
    DiscussionsRequestSchema,
    PlacesSearchRequestSchema,
    SearchRequestSchema,
    TrendsRequestSchema,
    VerticalSearchRequestSchema,
    YoutubeTranscriptRequestSchema,
} from "../schemas";
import { parsePrice } from "../services/pricing";
import { defineEndpoint, fixedPrice } from "./define";
import type { PriceModel } from "./define";

const SEARCH_TAGS = ["search", "serp"] as const;
const VERTICAL_INPUT_EXAMPLE = { query: "x402 payment protocol", limit: 10 };

/** Base search price, plus PRICING.contents.perUrl per result page fetched as markdown. */
const searchPricing: PriceModel<{ includeContent: boolean; contentResults: number }> = {
    resolve: (body) => {
        const pages = body?.includeContent ? body.contentResults : 0;
        return `$${(parsePrice(PRICING.search) + pages * parsePrice(PRICING.contents.perUrl)).toFixed(4)}`;
    },
    min: parsePrice(PRICING.search),
    max: parsePrice(PRICING.search) + SEARCH_CONTENT_RESULTS.max * parsePrice(PRICING.contents.perUrl),
};

/** Priced per depth tier. */
const deepResearchPricing: PriceModel<{ depth: DeepResearchDepth }> = {
    resolve: (body) => PRICING.deepResearch[body?.depth ?? DEEP_RESEARCH_DEFAULT_DEPTH],
    min: Math.min(...Object.values(PRICING.deepResearch).map(parsePrice)),
    max: Math.max(...Object.values(PRICING.deepResearch).map(parsePrice)),
};

export const SEARCH_ENDPOINTS = [
    defineEndpoint({
        path: "/search",
        title: "Web Search",
        description: "Real-time web search powered by Google. Returns ranked results with titles, URLs, and snippets. Set includeContent to also fetch the top result pages as markdown in the same call.",
        catalogTags: SEARCH_TAGS,
        input: SearchRequestSchema,
        inputExample: { query: "x402 payment protocol", limit: 10 },
        outputExample: {
            query: "x402 payment protocol",
            results: [{ title: "x402 Documentation", url: "https://x402.org", snippet: "HTTP-native micropayments..." }],
            searchedAt: "2026-01-26T12:00:00.000Z",
            requestId: "req_search456",
        },
        outputSchema: {
            properties: {
                query: { type: "string", description: "Original search query" },
                results: { type: "array", description: "Array of search results with title, url, snippet" },
                searchedAt: { type: "string", description: "ISO timestamp" },
                requestId: { type: "string" },
            },
        },
        price: searchPricing,
        acceptsCredits: true,
        evmOnly: false,
    }),
    defineEndpoint({
        path: "/search/news",
        title: "News Search",
        description: "Real-time news search via Google News. Returns ranked articles with source, date, and thumbnail.",
        catalogTags: SEARCH_TAGS,
        input: VerticalSearchRequestSchema,
        inputExample: VERTICAL_INPUT_EXAMPLE,
        outputExample: {
            query: "artificial intelligence",
            results: [{ position: 1, title: "AI breakthrough announced", url: "https://news.example.com/ai", source: "Example News", date: "07/25/2026, 10:00 AM", isoDate: "2026-07-25T10:00:00Z" }],
            searchedAt: "2026-07-25T12:00:00.000Z",
            requestId: "req_news123",
        },
        outputSchema: {
            properties: {
                query: { type: "string" },
                results: { type: "array", description: "Articles with position, title, url, source, date, isoDate, thumbnail" },
                searchedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
        price: fixedPrice(PRICING.searchVerticals.news),
        acceptsCredits: true,
        evmOnly: false,
    }),
    defineEndpoint({
        path: "/search/images",
        title: "Image Search",
        description: "Google Images search. Returns direct image URLs with dimensions, thumbnails, and source pages.",
        catalogTags: SEARCH_TAGS,
        input: VerticalSearchRequestSchema,
        inputExample: VERTICAL_INPUT_EXAMPLE,
        outputExample: {
            query: "golden gate bridge",
            results: [{ position: 1, title: "Golden Gate Bridge", imageUrl: "https://images.example.com/ggb.jpg", thumbnail: "https://t.example.com/ggb.jpg", sourcePage: "https://example.com/ggb", width: 1920, height: 1080 }],
            searchedAt: "2026-07-25T12:00:00.000Z",
            requestId: "req_img123",
        },
        outputSchema: {
            properties: {
                query: { type: "string" },
                results: { type: "array", description: "Images with position, title, imageUrl, thumbnail, sourcePage, source, width, height" },
                searchedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
        price: fixedPrice(PRICING.searchVerticals.images),
        acceptsCredits: true,
        evmOnly: false,
    }),
    defineEndpoint({
        path: "/search/places",
        title: "Places Search",
        description: "Local business search via Google Local. Returns names, addresses, ratings, reviews, phone numbers, websites, and coordinates.",
        catalogTags: SEARCH_TAGS,
        input: PlacesSearchRequestSchema,
        inputExample: { query: "coffee shops", location: "Austin, Texas", limit: 10 },
        outputExample: {
            query: "coffee shops",
            location: "Austin, Texas",
            results: [{ position: 1, name: "Example Coffee", address: "123 Main St, Austin, TX", rating: 4.7, reviews: 812, phone: "(512) 555-0100", website: "https://examplecoffee.com", coordinates: { latitude: 30.26, longitude: -97.74 } }],
            searchedAt: "2026-07-25T12:00:00.000Z",
            requestId: "req_places123",
        },
        outputSchema: {
            properties: {
                query: { type: "string" },
                location: { type: "string" },
                results: { type: "array", description: "Places with name, address, rating, reviews, priceLevel, category, phone, website, placeId, coordinates" },
                searchedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
        price: fixedPrice(PRICING.searchVerticals.places),
        acceptsCredits: true,
        evmOnly: false,
    }),
    defineEndpoint({
        path: "/search/shopping",
        title: "Shopping Search",
        description: "Google Shopping product search. Returns products with prices, sellers, ratings, and links.",
        catalogTags: SEARCH_TAGS,
        input: VerticalSearchRequestSchema,
        inputExample: VERTICAL_INPUT_EXAMPLE,
        outputExample: {
            query: "mechanical keyboard",
            results: [{ position: 1, title: "Mechanical Keyboard RGB", url: "https://shop.example.com/kb", price: "$89.99", extractedPrice: 89.99, source: "Example Store", rating: 4.5, reviews: 1200 }],
            searchedAt: "2026-07-25T12:00:00.000Z",
            requestId: "req_shop123",
        },
        outputSchema: {
            properties: {
                query: { type: "string" },
                results: { type: "array", description: "Products with position, title, url, price, extractedPrice, source, rating, reviews, thumbnail" },
                searchedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
        price: fixedPrice(PRICING.searchVerticals.shopping),
        acceptsCredits: true,
        evmOnly: false,
    }),
    defineEndpoint({
        path: "/search/scholar",
        title: "Scholar Search",
        description: "Google Scholar academic search. Returns papers with snippets, publication info, and citation counts.",
        catalogTags: SEARCH_TAGS,
        input: VerticalSearchRequestSchema,
        inputExample: VERTICAL_INPUT_EXAMPLE,
        outputExample: {
            query: "transformer attention mechanisms",
            results: [{ position: 1, title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762", snippet: "The dominant sequence transduction models...", publicationInfo: "A Vaswani, N Shazeer - NeurIPS, 2017", citedBy: 130000 }],
            searchedAt: "2026-07-25T12:00:00.000Z",
            requestId: "req_scholar123",
        },
        outputSchema: {
            properties: {
                query: { type: "string" },
                results: { type: "array", description: "Papers with position, title, url, snippet, publicationInfo, citedBy" },
                searchedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
        price: fixedPrice(PRICING.searchVerticals.scholar),
        acceptsCredits: true,
        evmOnly: false,
    }),
    defineEndpoint({
        path: "/search/autocomplete",
        title: "Autocomplete",
        description: "Google Autocomplete suggestions for a partial query. Useful for keyword research and intent discovery.",
        catalogTags: SEARCH_TAGS,
        input: VerticalSearchRequestSchema,
        inputExample: VERTICAL_INPUT_EXAMPLE,
        outputExample: {
            query: "how to deploy cloudf",
            suggestions: ["how to deploy cloudflare workers", "how to deploy cloudflare pages"],
            searchedAt: "2026-07-25T12:00:00.000Z",
            requestId: "req_auto123",
        },
        outputSchema: {
            properties: {
                query: { type: "string" },
                suggestions: { type: "array", description: "Suggestion strings ranked by relevance" },
                searchedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
        price: fixedPrice(PRICING.searchVerticals.autocomplete),
        acceptsCredits: true,
        evmOnly: false,
    }),
    defineEndpoint({
        path: "/search/trends",
        title: "Trends Search",
        description: "Google Trends interest-over-time for a query. Returns a timeline of relative search interest.",
        catalogTags: SEARCH_TAGS,
        input: TrendsRequestSchema,
        inputExample: { query: "cloudflare workers" },
        outputExample: {
            query: "cloudflare workers",
            timeline: [{ date: "Jul 20 - 26, 2026", timestamp: "1784908800", values: [{ query: "cloudflare workers", value: 87 }] }],
            searchedAt: "2026-07-25T12:00:00.000Z",
            requestId: "req_trends123",
        },
        outputSchema: {
            properties: {
                query: { type: "string" },
                timeline: { type: "array", description: "Interest-over-time points with date, timestamp, values[{query, value}]" },
                searchedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
        price: fixedPrice(PRICING.searchVerticals.trends),
        acceptsCredits: true,
        evmOnly: false,
    }),
    defineEndpoint({
        path: "/social/youtube/transcript",
        title: "YouTube Transcript",
        description: "Full transcript of any YouTube video with timestamps. Accepts a video ID or any YouTube URL.",
        catalogTags: ["video", "transcript", "youtube"],
        input: YoutubeTranscriptRequestSchema,
        inputExample: { videoId: "dQw4w9WgXcQ" },
        outputExample: {
            videoId: "dQw4w9WgXcQ",
            segments: [{ startMs: 0, startTime: "0:00", text: "We're no strangers to love" }],
            fullText: "We're no strangers to love...",
            fetchedAt: "2026-07-25T12:00:00.000Z",
            requestId: "req_yt123",
        },
        outputSchema: {
            properties: {
                videoId: { type: "string" },
                segments: { type: "array", description: "Transcript segments with startMs, startTime, text" },
                fullText: { type: "string", description: "All segments joined" },
                fetchedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
        price: fixedPrice(PRICING.youtubeTranscript),
        acceptsCredits: true,
        evmOnly: false,
    }),
    defineEndpoint({
        path: "/answer",
        title: "Grounded Answer",
        description: "Grounded answer with inline [n] citations: searches the web, fetches sources, and answers strictly from them.",
        catalogTags: ["search", "ai", "question-answering"],
        input: AnswerRequestSchema,
        inputExample: { query: "What is the x402 payment protocol?", sources: 3 },
        outputExample: {
            query: "What is the x402 payment protocol?",
            answer: "x402 is an open payment protocol built on HTTP 402 [1]. It settles USDC payments on Base [2].",
            citations: [{ index: 1, url: "https://x402.org", title: "x402 Protocol" }],
            confidence: 0.92,
            answeredAt: "2026-07-25T12:00:00.000Z",
            requestId: "req_answer123",
        },
        outputSchema: {
            properties: {
                query: { type: "string" },
                answer: { type: "string", description: "Answer text with inline [n] citation markers" },
                citations: { type: "array", description: "Citation list with index, url, title" },
                confidence: { type: "number" },
                answeredAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
        price: fixedPrice(PRICING.answer),
        acceptsCredits: true,
        evmOnly: false,
    }),
    defineEndpoint({
        path: "/research/deep",
        title: "Deep Research",
        description: `Multi-step research in one call: plans sub-questions, searches each, fetches and dedupes sources, and synthesizes an answer with inline [n] citations, key findings, and gaps. Tiers: ${describeDeepResearchTiers()}`,
        catalogTags: ["research", "ai", "multi-step"],
        input: DeepResearchRequestSchema,
        inputExample: { query: "How are AI agents using micropayments in 2026?", depth: "standard" },
        outputExample: {
            query: "How are AI agents using micropayments in 2026?",
            depth: "standard",
            subQuestions: ["x402 protocol adoption 2026", "AI agent payment volume statistics", "micropayment API pricing for agents"],
            answer: "Agent micropayments consolidated around the x402 protocol in 2026 [1]. Transaction counts recovered sharply while average payment sizes fell [2][3].",
            keyFindings: ["Transaction volume is dominated by a small number of gateways", "Median per-call price sits near $0.01"],
            citations: [{ index: 1, url: "https://x402.org", title: "x402 Protocol", subQuestion: "x402 protocol adoption 2026" }],
            gaps: ["Sources did not cover settlement failure rates"],
            sourcesFetched: 8,
            researchedAt: "2026-07-31T12:00:00.000Z",
            requestId: "req_deepresearch123",
        },
        outputSchema: {
            properties: {
                query: { type: "string" },
                depth: { type: "string" },
                subQuestions: { type: "array", description: "The sub-questions researched" },
                answer: { type: "string", description: "Synthesized answer with inline [n] citation markers" },
                keyFindings: { type: "array", description: "Bullet-point findings" },
                citations: { type: "array", description: "Citations with index, url, title, subQuestion" },
                gaps: { type: "array", description: "What the sources did not establish" },
                sourcesFetched: { type: "number" },
                researchedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
        price: deepResearchPricing,
        acceptsCredits: true,
        evmOnly: false,
    }),
    defineEndpoint({
        path: "/discussions",
        title: "Discussions",
        description: "What Hacker News said about a topic: matching stories with points, comment counts and links to the threads, plus aggregates — total matches, points and comments returned, the domains most often submitted, and the first/last time it was discussed.",
        catalogTags: ["search", "social"],
        input: DiscussionsRequestSchema,
        inputExample: { query: "cloudflare workers", limit: 10 },
        outputExample: {
            query: "cloudflare workers", source: "hackernews", sort: "relevance",
            stories: [{ title: "Workerd: Open-source Cloudflare Workers runtime", url: "https://github.com/cloudflare/workerd", points: 689, comments: 133, author: "jgrahamc", postedAt: "2022-09-27T14:00:00.000Z", discussionUrl: "https://news.ycombinator.com/item?id=32979198" }],
            summary: { totalMatches: 1259, returned: 10, pointsReturned: 3421, commentsReturned: 2870, topDomains: [{ domain: "github.com", count: 3 }], firstSeen: "2018-03-12T00:00:00.000Z", lastSeen: "2026-07-30T00:00:00.000Z" },
            discussedAt: "2026-08-02T12:00:00.000Z",
            requestId: "req_disc123",
        },
        outputSchema: {
            properties: {
                query: { type: "string" }, source: { type: "string" }, sort: { type: "string" },
                stories: { type: "array", description: "Each: title, url, points, comments, author, postedAt, discussionUrl" },
                summary: { type: "object", description: "totalMatches, returned, pointsReturned, commentsReturned, topDomains, firstSeen, lastSeen" },
                discussedAt: { type: "string" }, requestId: { type: "string" },
            },
        },
        price: fixedPrice(PRICING.discussions),
        acceptsCredits: true,
        evmOnly: false,
    }),
] as const;
