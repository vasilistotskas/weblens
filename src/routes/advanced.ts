import type { Hono } from "hono";
import { PRICING } from "../config";
import { createCreditMiddleware } from "../middleware/credit-middleware";
import { createLazyPaymentMiddleware } from "../middleware/payment";
import { validateRequest } from "../middleware/validation";
import {
    BatchFetchRequestSchema,
    ResearchRequestSchema,
    PdfRequestSchema,
    CompareRequestSchema
} from "../schemas";
import { getBatchFetchPrice } from "../services/pricing";

// Tool Handlers
import { batchFetchHandler } from "../tools/batch-fetch";
import { compareHandler } from "../tools/compare";
import { pdfHandler } from "../tools/pdf";
import { researchHandler } from "../tools/research";
import type { Env, Variables } from "../types";

export function registerAdvancedRoutes(app: Hono<{ Bindings: Env; Variables: Variables }>) {

    // ============================================
    // /batch/fetch
    // ============================================
    app.use(
        "/batch/fetch",
        createCreditMiddleware(
            () => getBatchFetchPrice(2), // Minimum price for check
            "Batch URL Fetching (Minimum)"
        ),
        validateRequest(BatchFetchRequestSchema),
        createLazyPaymentMiddleware(
            "/batch/fetch",
            "$0.006", // Minimum price for 2 URLs
            "Fetch multiple URLs in parallel with a single request. Efficient for bulk operations. Supports 2-20 URLs per request at $0.003/URL.",
            { urls: ["https://example.com/1", "https://example.com/2"], timeout: 10000, tier: "basic" },
            {
                properties: {
                    urls: { type: "array", description: "Array of URLs to fetch (2-20)" },
                    timeout: { type: "number", description: "Per-URL timeout in ms (default: 10000)" },
                    tier: { type: "string", description: "Fetch tier: basic or pro (default: basic)" },
                },
                required: ["urls"],
            },
            {
                results: [
                    { url: "https://example.com/1", status: "success", title: "Page 1", content: "Content 1..." },
                    { url: "https://example.com/2", status: "success", title: "Page 2", content: "Content 2..." },
                ],
                summary: { total: 2, successful: 2, failed: 0 },
                totalPrice: "$0.006",
                requestId: "req_batch123",
            },
            {
                properties: {
                    results: { type: "array", description: "Array of fetch results with url, status, content, title" },
                    summary: { type: "object", description: "Summary with total, successful, failed counts" },
                    totalPrice: { type: "string" },
                    requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/batch/fetch", batchFetchHandler);

    // ============================================
    // /research
    // ============================================
    app.use(
        "/research",
        createCreditMiddleware(PRICING.research, "AI Research Assistant"),
        validateRequest(ResearchRequestSchema),
        createLazyPaymentMiddleware(
            "/research",
            PRICING.research,
            "One-stop research assistant: searches the web, fetches top results, and generates an AI-powered summary with key findings.",
            { query: "x402 payment protocol benefits", resultCount: 5, includeRawContent: false },
            {
                properties: {
                    query: { type: "string", description: "Research topic or question" },
                    resultCount: { type: "number", description: "Number of sources to analyze, 1-10 (default: 5)", minimum: 1, maximum: 10 },
                    includeRawContent: { type: "boolean", description: "Include full fetched content in response" },
                },
                required: ["query"],
            },
            {
                query: "x402 payment protocol benefits",
                sources: [
                    { url: "https://x402.org", title: "x402 Protocol", snippet: "HTTP-native micropayments..." },
                ],
                summary: "x402 is an open payment protocol...",
                keyFindings: ["Zero fees", "Instant settlement"],
                researchedAt: "2026-01-26T12:00:00.000Z",
                requestId: "req_research456",
            },
            {
                properties: {
                    query: { type: "string" },
                    sources: { type: "array", description: "Array of sources with url, title, snippet" },
                    summary: { type: "string", description: "AI-generated research summary" },
                    keyFindings: { type: "array", description: "Bullet points of key findings" },
                    researchedAt: { type: "string" },
                    requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/research", researchHandler);

    // ============================================
    // /pdf
    // ============================================
    app.use(
        "/pdf",
        createCreditMiddleware(PRICING.pdf, "PDF Text Extraction"),
        validateRequest(PdfRequestSchema),
        createLazyPaymentMiddleware(
            "/pdf",
            PRICING.pdf,
            "Extract text and metadata from PDF documents. Supports page-specific extraction and returns structured content.",
            { url: "https://example.com/document.pdf", pages: [1, 2, 3] },
            {
                properties: {
                    url: { type: "string", description: "URL of the PDF document" },
                    pages: { type: "array", description: "Specific page numbers to extract (omit for all pages)" },
                },
                required: ["url"],
            },
            {
                url: "https://example.com/document.pdf",
                metadata: { title: "Sample Document", author: "John Doe", pageCount: 10 },
                pages: [
                    { pageNumber: 1, content: "Page 1 text content..." },
                ],
                fullText: "Page 1 text content...",
                extractedAt: "2026-01-26T12:00:00.000Z",
                requestId: "req_pdf123",
            },
            {
                properties: {
                    url: { type: "string" },
                    metadata: { type: "object", description: "PDF metadata" },
                    pages: { type: "array", description: "Array of pages with content" },
                    fullText: { type: "string", description: "All pages concatenated" },
                    extractedAt: { type: "string" },
                    requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/pdf", pdfHandler);

    // ============================================
    // /compare
    // ============================================
    app.use(
        "/compare",
        createCreditMiddleware(PRICING.compare, "Webpage Comparison"),
        validateRequest(CompareRequestSchema),
        createLazyPaymentMiddleware(
            "/compare",
            PRICING.compare,
            "Compare 2-3 webpages with AI-generated analysis. Identifies similarities, differences, and provides a comprehensive summary.",
            { urls: ["https://product-a.com", "https://product-b.com"], focus: "pricing and features" },
            {
                properties: {
                    urls: { type: "array", description: "Array of 2-3 URLs to compare" },
                    focus: { type: "string", description: "What aspect to focus the comparison on" },
                },
                required: ["urls"],
            },
            {
                sources: [
                    { url: "https://product-a.com", title: "Product A", content: "Features: X..." },
                    { url: "https://product-b.com", title: "Product B", content: "Features: Y..." },
                ],
                comparison: {
                    similarities: ["Both offer feature X"],
                    differences: ["Product A has Z"],
                    summary: "Product A focuses on...",
                },
                comparedAt: "2026-01-26T12:00:00.000Z",
                requestId: "req_compare456",
            },
            {
                properties: {
                    sources: { type: "array", description: "Array of sources with url, title, content" },
                    comparison: { type: "object", description: "Comparison with similarities, differences, summary" },
                    comparedAt: { type: "string" },
                    requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/compare", compareHandler);
}
