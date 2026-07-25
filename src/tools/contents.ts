/**
 * Contents Endpoint Handler
 * POST /contents — cheap bulk page-text retrieval ($0.002/URL)
 *
 * The "give me the page text" primitive at market clearing price. Unlike
 * /batch/fetch it accepts a single URL, has no tier/proof overhead, and
 * truncates content to a per-page cap so responses stay LLM-sized.
 */

import type { Context } from "hono";
import type { z } from "zod/v4";
import { createErrorResponse } from "../middleware/errorHandler";
import type { ContentsRequestSchema } from "../schemas";
import type { Env } from "../types";
import { fetchBasicPage } from "./fetch-basic";

interface ContentResult {
    url: string;
    status: "success" | "failed";
    title?: string;
    content?: string;
    truncated?: boolean;
    error?: string;
}

export async function contentsHandler(c: Context<{ Bindings: Env }>) {
    const requestId = c.get("requestId");
    try {
        const { urls, maxChars, timeout } = c.get("validatedBody") as z.infer<typeof ContentsRequestSchema>;

        const settled = await Promise.allSettled(
            urls.map((url) => fetchBasicPage(url, timeout)),
        );

        const results: ContentResult[] = urls.map((url, i) => {
            const outcome = settled[i];
            if (!outcome || outcome.status === "rejected") {
                const reason = outcome?.reason instanceof Error ? outcome.reason.message : String(outcome?.reason ?? "fetch failed");
                return { url, status: "failed", error: reason };
            }
            const page = outcome.value;
            const truncated = page.content.length > maxChars;
            return {
                url,
                status: "success",
                title: page.title,
                content: truncated ? page.content.slice(0, maxChars) : page.content,
                truncated,
            };
        });

        const successful = results.filter((r) => r.status === "success").length;
        return c.json({
            results,
            summary: { total: urls.length, successful, failed: urls.length - successful },
            fetchedAt: new Date().toISOString(),
            requestId,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return c.json(createErrorResponse("INTERNAL_ERROR", message, requestId), 500);
    }
}
