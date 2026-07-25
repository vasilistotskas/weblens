/**
 * Answer Endpoint Handler
 * POST /answer — grounded answer with inline [n] citations ($0.05)
 *
 * Pipeline: one SerpAPI search → fetch top-N pages (safeFetch via
 * fetchBasicPage) → one capped Haiku call. Content is truncated to keep the
 * worst-case upstream cost (~$0.026) safely under the price.
 */

import type { Context } from "hono";
import type { z } from "zod/v4";
import { createErrorResponse } from "../middleware/errorHandler";
import type { AnswerRequestSchema } from "../schemas";
import { callClaude, isAIAvailable, handleAIError, AIUnavailableError } from "../services/ai";
import { searchWeb } from "../services/search";
import type { Env } from "../types";
import { fetchBasicPage } from "./fetch-basic";

// Cost control: cheap model + hard caps on per-source content and output.
const ANSWER_MODEL = "claude-haiku-4-5-20251001";
const ANSWER_MAX_TOKENS = 1200;
const PER_SOURCE_CHARS = 8000;

interface AnswerCitation { index: number; url: string; title: string }

export async function answerHandler(c: Context<{ Bindings: Env }>) {
    const requestId = c.get("requestId");
    try {
        const { query, sources: sourceCount } = c.get("validatedBody") as z.infer<typeof AnswerRequestSchema>;

        if (!isAIAvailable(c.env.ANTHROPIC_API_KEY)) {
            return c.json(
                createErrorResponse("AI_UNAVAILABLE", "AI service not configured. Set ANTHROPIC_API_KEY for answers.", requestId),
                503,
            );
        }

        const searchResults = await searchWeb({
            query,
            limit: sourceCount,
            serpApiKey: c.env.SERP_API_KEY,
        });
        if (searchResults.length === 0) {
            return c.json(
                createErrorResponse("NOT_FOUND", "No web sources found for this query", requestId),
                404,
            );
        }

        const fetched = await Promise.allSettled(
            searchResults.map((r) => fetchBasicPage(r.url, 10000)),
        );
        const citations: AnswerCitation[] = [];
        const sourceBlocks: string[] = [];
        searchResults.forEach((r, i) => {
            const outcome = fetched[i];
            const content = outcome?.status === "fulfilled"
                ? outcome.value.content.slice(0, PER_SOURCE_CHARS)
                : r.snippet; // fall back to the SERP snippet so the source stays citable
            const index = citations.length + 1;
            citations.push({ index, url: r.url, title: r.title });
            sourceBlocks.push(`[${String(index)}] ${r.title} (${r.url})\n${content}`);
        });

        const systemPrompt = `You answer questions using ONLY the provided web sources.
Cite sources inline with bracketed indices like [1] or [2][3] after each claim.
If the sources do not contain the answer, say so plainly.
Respond with valid JSON in this exact format:
{"answer": "The answer text with inline [1] citations.", "confidence": 0.9}`;

        const prompt = `Question: ${query}

Sources:
${sourceBlocks.join("\n\n")}

Respond ONLY with valid JSON.`;

        const raw = await callClaude(
            { apiKey: c.env.ANTHROPIC_API_KEY, model: ANSWER_MODEL, maxTokens: ANSWER_MAX_TOKENS },
            prompt,
            systemPrompt,
        );

        let answer = raw;
        let confidence: number | undefined;
        try {
            const parsed = JSON.parse(raw) as { answer?: string; confidence?: number };
            if (parsed.answer) {
                answer = parsed.answer;
                confidence = parsed.confidence;
            }
        } catch {
            // Model returned plain text — serve it as-is with the citation list.
        }

        return c.json({
            query,
            answer,
            citations,
            confidence,
            answeredAt: new Date().toISOString(),
            requestId,
        });
    } catch (error) {
        if (error instanceof AIUnavailableError) {
            const aiError = handleAIError(error);
            return c.json(
                createErrorResponse(aiError.code as "AI_UNAVAILABLE", aiError.message, requestId),
                aiError.status as 503,
            );
        }
        const message = error instanceof Error ? error.message : "Unknown error";
        return c.json(createErrorResponse("INTERNAL_ERROR", message, requestId), 500);
    }
}
