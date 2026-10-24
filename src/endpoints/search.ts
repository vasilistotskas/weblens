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
/** Shopping needs a product query: "x402 payment protocol" has no shopping results. */
const SHOPPING_INPUT_EXAMPLE = { query: "mechanical keyboard", limit: 10 };

/** Base search price, plus PRICING.contents.perUrl per result page fetched as markdown. */
const searchPricing: PriceModel<{ includeContent: boolean; contentResults: number }> = {
    resolve: (body) => {
        const pages = body?.includeContent ? body.contentResults : 0;
        return `$${(parsePrice(PRICING.search) + pages * parsePrice(PRICING.contents.perUrl)).toFixed(4)}`;
    },
    min: parsePrice(PRICING.search),
    max: parsePrice(PRICING.search) + SEARCH_CONTENT_RESULTS.max * parsePrice(PRICING.contents.perUrl),
    describe: `${PRICING.search}, plus ${PRICING.contents.perUrl} per result page fetched with includeContent`,
};

/** Priced per depth tier. */
const deepResearchPricing: PriceModel<{ depth: DeepResearchDepth }> = {
    resolve: (body) => PRICING.deepResearch[body?.depth ?? DEEP_RESEARCH_DEFAULT_DEPTH],
    min: Math.min(...Object.values(PRICING.deepResearch).map(parsePrice)),
    max: Math.max(...Object.values(PRICING.deepResearch).map(parsePrice)),
    describe: describeDeepResearchTiers(),
};

export const SEARCH_ENDPOINTS = [
    defineEndpoint({
        path: "/search",
        title: "Web Search",
        group: "Search",
        operationId: "searchWeb",
        guide: [
            "With `includeContent`, each result also carries `content` (the page as markdown) and `contentTruncated`.",
        ],
        mcpTool: "search_web",
        latency: "1-2 seconds",
        previewSummary: "Ranked web results; set includeContent to get page markdown too.",
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
                results: {
                    type: "array",
                    items: { type: "object" },
                    description: "Search results with title, url, snippet; with includeContent also content and contentTruncated",
                },
                searchedAt: { type: "string", description: "ISO timestamp" },
                requestId: { type: "string" },
            },
        },
        price: searchPricing,
    }),
    defineEndpoint({
        path: "/search/news",
        title: "News Search",
        group: "Search",
        operationId: "searchNews",
        mcpTool: "search_news",
        latency: "1-2 seconds",
        previewSummary: "Google News articles with source, date, and thumbnail.",
        description: "Real-time news search via Google News. Returns up to 10 ranked articles with snippet, source, date, and thumbnail.",
        catalogTags: SEARCH_TAGS,
        input: VerticalSearchRequestSchema,
        inputExample: VERTICAL_INPUT_EXAMPLE,
        outputExample: {
            query: "artificial intelligence",
            results: [{ position: 1, title: "AI breakthrough announced", url: "https://news.example.com/ai", snippet: "Researchers announced a new model that...", source: "Example News", date: "2 hours ago", thumbnail: "https://t.example.com/ai.jpg" }],
            searchedAt: "2026-07-25T12:00:00.000Z",
            requestId: "req_news123",
        },
        outputSchema: {
            properties: {
                query: { type: "string" },
                results: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            position: { type: "integer" },
                            title: { type: "string" },
                            url: { type: "string" },
                            snippet: { type: "string" },
                            source: { type: "string" },
                            date: { type: "string", description: "As Google shows it, often relative (\"2 hours ago\")" },
                            thumbnail: { type: "string" },
                        },
                    },
                    description: "Articles with position, title, url, snippet, source, date, thumbnail",
                },
                searchedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
        price: fixedPrice(PRICING.searchVerticals.news),
    }),
    defineEndpoint({
        path: "/search/images",
        title: "Image Search",
        group: "Search",
        operationId: "searchImages",
        mcpTool: "search_images",
        latency: "1-2 seconds",
        previewSummary: "Direct image URLs with dimensions and source pages.",
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
                results: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            position: { type: "integer" },
                            title: { type: "string" },
                            imageUrl: { type: "string" },
                            thumbnail: { type: "string" },
                            sourcePage: { type: "string" },
                            source: { type: "string" },
                            width: { type: "integer" },
                            height: { type: "integer" },
                        },
                    },
                    description: "Images with position, title, imageUrl, thumbnail, sourcePage, source, width, height",
                },
                searchedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
        price: fixedPrice(PRICING.searchVerticals.images),
    }),
    defineEndpoint({
        path: "/search/places",
        title: "Places Search",
        group: "Search",
        operationId: "searchPlaces",
        mcpTool: "search_places",
        latency: "1-3 seconds",
        previewSummary: "Local businesses: address, rating, reviews, phone, coordinates.",
        description: "Local business search via Google Places. Returns names, addresses, categories, ratings, reviews, phone numbers, websites, and coordinates.",
        catalogTags: SEARCH_TAGS,
        input: PlacesSearchRequestSchema,
        inputExample: { query: "coffee shops", location: "Austin, Texas", limit: 10 },
        outputExample: {
            query: "coffee shops",
            location: "Austin, Texas",
            results: [{ position: 1, name: "Example Coffee", address: "123 Main St, Austin, TX", rating: 4.7, reviews: 812, category: "Coffee shop", phone: "(512) 555-0100", website: "https://examplecoffee.com", cid: "6353588238324409422", coordinates: { latitude: 30.26, longitude: -97.74 } }],
            searchedAt: "2026-07-25T12:00:00.000Z",
            requestId: "req_places123",
        },
        outputSchema: {
            properties: {
                query: { type: "string" },
                location: { type: "string" },
                results: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            position: { type: "integer" },
                            name: { type: "string" },
                            address: { type: "string" },
                            rating: { type: "number" },
                            reviews: { type: "integer" },
                            priceLevel: { type: "string", description: "As Google shows it, e.g. \"$\" or \"$10-20\"" },
                            category: { type: "string" },
                            phone: { type: "string" },
                            website: { type: "string" },
                            cid: { type: "string", description: "Google Maps customer id (maps.google.com/?cid=...)" },
                            coordinates: { type: "object" },
                        },
                    },
                    description: "Places with name, address, rating, reviews, priceLevel, category, phone, website, cid, coordinates",
                },
                searchedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
        price: fixedPrice(PRICING.searchVerticals.places),
    }),
    defineEndpoint({
        path: "/search/shopping",
        title: "Shopping Search",
        group: "Search",
        operationId: "searchShopping",
        mcpTool: "search_shopping",
        latency: "1-2 seconds",
        previewSummary: "Products with prices, sellers, and ratings.",
        description: "Google Shopping product search. Returns products with prices, sellers, ratings, and links.",
        catalogTags: SEARCH_TAGS,
        input: VerticalSearchRequestSchema,
        inputExample: SHOPPING_INPUT_EXAMPLE,
        outputExample: {
            query: "mechanical keyboard",
            results: [{ position: 1, title: "Mechanical Keyboard RGB", url: "https://shop.example.com/kb", price: "$89.99", delivery: "Free delivery", source: "Example Store", rating: 4.5, reviews: 1200 }],
            searchedAt: "2026-07-25T12:00:00.000Z",
            requestId: "req_shop123",
        },
        outputSchema: {
            properties: {
                query: { type: "string" },
                results: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            position: { type: "integer" },
                            title: { type: "string" },
                            url: { type: "string" },
                            price: { type: "string", description: "As Google shows it, with currency (\"$89.99\")" },
                            delivery: { type: "string" },
                            source: { type: "string" },
                            rating: { type: "number" },
                            reviews: { type: "integer" },
                            thumbnail: { type: "string" },
                        },
                    },
                    description: "Products with position, title, url, price, delivery, source, rating, reviews, thumbnail",
                },
                searchedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
        price: fixedPrice(PRICING.searchVerticals.shopping),
    }),
    defineEndpoint({
        path: "/search/scholar",
        title: "Scholar Search",
        group: "Search",
        operationId: "searchScholar",
        mcpTool: "search_scholar",
        latency: "1-2 seconds",
        previewSummary: "Academic papers with publication info and citation counts.",
        description: "Google Scholar academic search. Returns papers with snippets, publication info, and citation counts.",
        catalogTags: SEARCH_TAGS,
        input: VerticalSearchRequestSchema,
        inputExample: VERTICAL_INPUT_EXAMPLE,
        outputExample: {
            query: "transformer attention mechanisms",
            results: [{ position: 1, title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762", snippet: "The dominant sequence transduction models...", publicationInfo: "A Vaswani, N Shazeer - NeurIPS, 2017", year: 2017, citedBy: 130000 }],
            searchedAt: "2026-07-25T12:00:00.000Z",
            requestId: "req_scholar123",
        },
        outputSchema: {
            properties: {
                query: { type: "string" },
                results: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            position: { type: "integer" },
                            title: { type: "string" },
                            url: { type: "string" },
                            pdfUrl: { type: "string", description: "Direct PDF link, when Google Scholar has one" },
                            snippet: { type: "string" },
                            publicationInfo: { type: "string" },
                            year: { type: "integer" },
                            citedBy: { type: "integer" },
                        },
                    },
                    description: "Papers with position, title, url, pdfUrl, snippet, publicationInfo, year, citedBy",
                },
                searchedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
        price: fixedPrice(PRICING.searchVerticals.scholar),
    }),
    defineEndpoint({
        path: "/search/autocomplete",
        title: "Autocomplete",
        group: "Search",
        operationId: "searchAutocomplete",
        mcpTool: "search_autocomplete",
        latency: "<1 second",
        previewSummary: "Query suggestions — keyword and intent research.",
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
                suggestions: {
                    type: "array",
                    items: { type: "string" },
                    description: "Suggestion strings ranked by relevance",
                },
                searchedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
        price: fixedPrice(PRICING.searchVerticals.autocomplete),
    }),
    defineEndpoint({
        path: "/search/trends",
        title: "Trends Search",
        group: "Search",
        operationId: "searchTrends",
        mcpTool: "search_trends",
        latency: "1-3 seconds",
        previewSummary: "Interest-over-time timeline for a topic.",
        description: "Google Trends interest over time for a topic, worldwide: a timeline of relative search interest per period (0-100, where 100 is the topic's peak). Use it to see whether interest in a product, technology, brand or keyword is rising, falling or seasonal.",
        catalogTags: ["google trends", "trends", "search interest", "keyword research", "market research"],
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
                timeline: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            date: { type: "string" },
                            timestamp: { type: "string" },
                            values: {
                                type: "array",
                                items: { type: "object" },
                            },
                        },
                    },
                    description: "Interest-over-time points with date, timestamp, values[{query, value}]",
                },
                searchedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
        price: fixedPrice(PRICING.searchVerticals.trends),
    }),
    defineEndpoint({
        path: "/social/youtube/transcript",
        title: "YouTube Transcript",
        group: "Social",
        operationId: "youtubeTranscript",
        guide: [
            "Accepts a video ID or any YouTube URL (watch, shorts, youtu.be). `language` echoes the `lang` you asked for.",
        ],
        errors: {
            "404": "No transcript available for this video",
        },
        mcpTool: "youtube_transcript",
        latency: "1-3 seconds",
        previewSummary: "Full video transcript with timestamps.",
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
                language: { type: "string", description: "The transcript language you requested with lang, when given" },
                segments: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            startMs: { type: "integer" },
                            startTime: { type: "string" },
                            text: { type: "string" },
                        },
                    },
                    description: "Transcript segments with startMs, startTime, text",
                },
                fullText: { type: "string", description: "All segments joined" },
                fetchedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
        price: fixedPrice(PRICING.youtubeTranscript),
    }),
    defineEndpoint({
        path: "/answer",
        title: "Grounded Answer",
        group: "Research",
        operationId: "answerQuestion",
        mcpTool: "answer_question",
        latency: "5-20 seconds",
        previewSummary: "A direct answer with inline [n] citations to real sources.",
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
                citations: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            index: { type: "integer" },
                            url: { type: "string" },
                            title: { type: "string" },
                        },
                    },
                    description: "Citation list with index, url, title",
                },
                confidence: { type: "number" },
                answeredAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
        price: fixedPrice(PRICING.answer),
    }),
    defineEndpoint({
        path: "/research/deep",
        title: "Deep Research",
        group: "Research",
        operationId: "deepResearch",
        guide: [
            "**SLOW: set a generous HTTP timeout.** A standard run takes roughly 30-60 seconds (measured ~35s); deep takes longer. 120s client timeout recommended. Do not retry on client timeout: you would pay twice.",
        ],
        errors: {
            "404": "No web sources found for this query — nothing was charged for a failed run.",
            "502": "Research failed or timed out before completing.",
            "503": "AI service unavailable",
        },
        mcpTool: "deep_research",
        latency: "30-60 seconds",
        previewSummary: "Multi-step research: sub-questions, cited answer, and gaps.",
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
                depth: {
                    type: "string",
                    enum: ["quick", "standard", "deep"],
                },
                subQuestions: {
                    type: "array",
                    items: { type: "string" },
                    description: "The sub-questions the query was decomposed into, one web search each. For quick, the query itself.",
                },
                answer: { type: "string", description: "Synthesized answer with inline [n] citation markers" },
                keyFindings: {
                    type: "array",
                    items: { type: "string" },
                    description: "Bullet-point findings drawn from the sources",
                },
                citations: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            index: { type: "integer" },
                            url: { type: "string" },
                            title: { type: "string" },
                            subQuestion: { type: "string" },
                        },
                    },
                    description: "Sources behind the [n] markers, with the sub-question each answered",
                },
                gaps: {
                    type: "array",
                    items: { type: "string" },
                    description: "What the sources did not establish",
                },
                sourcesFetched: {
                    type: "number",
                    description: "Sources whose full page was fetched (the rest fall back to their search snippet)",
                },
                researchedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
        price: deepResearchPricing,
    }),
    defineEndpoint({
        path: "/discussions",
        title: "Discussions",
        group: "Search",
        operationId: "searchDiscussions",
        guide: [
            "`pointsReturned`/`commentsReturned` sum the returned stories only; `totalMatches` is Hacker News's full count.",
        ],
        mcpTool: "search_discussions",
        latency: "1-3 seconds",
        previewSummary: "What Hacker News said about a topic, with points, comments and aggregates.",
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
                query: { type: "string" },
                source: {
                    type: "string",
                    enum: ["hackernews"],
                },
                sort: { type: "string" },
                stories: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            title: { type: "string" },
                            url: { type: "string" },
                            points: { type: "integer" },
                            comments: { type: "integer" },
                            author: { type: "string" },
                            postedAt: { type: "string" },
                            discussionUrl: { type: "string", description: "Link to the HN thread" },
                        },
                    },
                    description: "Each: title, url, points, comments, author, postedAt, discussionUrl",
                },
                summary: {
                    type: "object",
                    properties: {
                        totalMatches: { type: "integer", description: "Stories HN matched overall, which may exceed those returned" },
                        returned: { type: "integer" },
                        pointsReturned: { type: "integer", description: "Summed over the RETURNED stories only" },
                        commentsReturned: { type: "integer", description: "Summed over the RETURNED stories only" },
                        topDomains: { type: "array", description: "Most-submitted domains among the returned stories" },
                        firstSeen: { type: "string" },
                        lastSeen: { type: "string" },
                    },
                    description: "totalMatches, returned, pointsReturned, commentsReturned, topDomains, firstSeen, lastSeen",
                },
                discussedAt: { type: "string" },
                requestId: { type: "string" },
            },
        },
        price: fixedPrice(PRICING.discussions),
    }),
] as const;
