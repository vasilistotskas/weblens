/**
 * Reader Endpoint Handler
 *
 * Zero-friction GET endpoint: GET /r/https://example.com
 * Returns markdown content with no auth, no payment, no POST body.
 * Inspired by Jina Reader's r.jina.ai/url pattern.
 */

import type { Context } from "hono";
import { FREE_TIER } from "../config";
import { validateURL } from "../services/validator";
import type { Env } from "../types";
import { generateRequestId } from "../utils/requestId";
import { fetchBasicPage } from "./fetch-basic";

/**
 * Extract the target URL from the request path.
 * Given /r/https://example.com/path?q=1, returns https://example.com/path?q=1
 *
 * The `format` query param is reserved for WebLens (json|text).
 * All other query params are passed through to the target URL.
 */
function extractTargetUrl(c: Context): string | null {
    const reqUrl = new URL(c.req.url);
    // Everything after "/r/" in the pathname
    const targetPath = reqUrl.pathname.substring(3);

    if (!targetPath) {
        return null;
    }

    // Reconstruct target URL query params (excluding our reserved 'format' param)
    const params = new URLSearchParams(reqUrl.search);
    params.delete("format");
    const targetQuery = params.toString();

    return targetQuery ? `${targetPath}?${targetQuery}` : targetPath;
}

/**
 * GET /r/*
 * Zero-friction reader — fetch any URL as markdown with a single GET request.
 */
export async function readerHandler(c: Context<{ Bindings: Env }>) {
    const requestId = generateRequestId();
    const format = c.req.query("format") ?? "json";

    // Extract target URL from path
    const targetUrl = extractTargetUrl(c);

    if (!targetUrl) {
        if (format === "text") {
            return c.text(
                "Error: Missing URL\n\nUsage: GET /r/https://example.com\nDocs:  https://api.weblens.dev/docs\n",
                400
            );
        }
        return c.json({
            error: "MISSING_URL",
            code: "MISSING_URL",
            message: "Append a URL after /r/ — e.g. GET /r/https://example.com",
            requestId,
            usage: "GET /r/https://example.com",
            docs: "https://api.weblens.dev/docs",
        }, 400);
    }

    // Validate URL
    const urlValidation = validateURL(targetUrl);
    if (!urlValidation.valid) {
        if (format === "text") {
            return c.text(
                `Error: ${urlValidation.error ?? "Invalid URL"}\n\nUsage: GET /r/https://example.com\n`,
                400
            );
        }
        return c.json({
            error: "INVALID_URL",
            code: "INVALID_URL",
            message: urlValidation.error ?? "Invalid URL",
            requestId,
        }, 400);
    }

    try {
        const result = await fetchBasicPage(
            urlValidation.normalized ?? targetUrl,
            10000
        );

        // Truncate content to free tier limit
        const maxLen = FREE_TIER.fetchMaxContentLength;
        const isTruncated = result.content.length > maxLen;
        const content = isTruncated
            ? result.content.slice(0, maxLen) + "\n\n--- Content truncated (free tier) ---"
            : result.content;

        // Plain text / markdown response
        if (format === "text" || format === "markdown") {
            const text = `# ${result.title}\n\n${content}\n\n---\nFetched by WebLens (api.weblens.dev) | Full content: POST /fetch/basic ($0.005)\n`;
            return c.text(text, 200);
        }

        // JSON response (default)
        return c.json({
            url: result.url,
            title: result.title,
            content,
            metadata: result.metadata,
            truncated: isTruncated,
            fetchedAt: result.fetchedAt,
            requestId,
            _reader: {
                tier: "free",
                limit: `${String(maxLen)} chars`,
                rateLimit: `${String(FREE_TIER.maxRequestsPerHour)}/hour`,
                upgrade: {
                    fullContent: "POST /fetch/basic ($0.005)",
                    jsRendering: "POST /fetch/pro ($0.015)",
                    docs: "https://api.weblens.dev/docs",
                },
            },
        });
    } catch (error) {
        const rawMessage = error instanceof Error ? error.message : "Unknown error";

        if (rawMessage.includes("timeout") || rawMessage.includes("aborted")) {
            if (format === "text") {
                return c.text("Error: Target URL timed out\n", 502);
            }
            return c.json({
                error: "FETCH_TIMEOUT",
                code: "FETCH_TIMEOUT",
                message: "Target URL failed to respond within timeout period",
                requestId,
            }, 502);
        }

        if (rawMessage.includes("redirect")) {
            if (format === "text") {
                return c.text("Error: Target URL returned a redirect. Use the final URL directly.\n", 502);
            }
            return c.json({
                error: "REDIRECT_BLOCKED",
                code: "REDIRECT_BLOCKED",
                message: "Target URL returned a redirect. Use the final URL directly.",
                requestId,
            }, 502);
        }

        console.error(`[Reader] Error fetching URL: ${rawMessage}`);
        if (format === "text") {
            return c.text("Error: Failed to fetch the requested URL\n", 500);
        }
        return c.json({
            error: "INTERNAL_ERROR",
            code: "INTERNAL_ERROR",
            message: "Failed to fetch the requested URL",
            requestId,
        }, 500);
    }
}
