/**
 * Deep Research Service
 *
 * Multi-step research in ONE synchronous call: plan sub-questions → run a
 * search per sub-question → fetch and dedupe sources → synthesise an answer
 * with inline [n] citations.
 *
 * Synchronous by design, same reasoning as /crawl: an async job needs a
 * polling endpoint, which fits x402's one-shot-per-request payment badly.
 * Workers bill CPU, not network wait, so a bounded multi-step pipeline of
 * network calls runs comfortably inside one request.
 *
 * COST CONTROL (the price floor depends on these bounds — see PRICING.deepResearch):
 *   - sub-questions are capped per depth tier; each costs one SerpAPI call
 *   - sources are capped and truncated per source before they reach the model
 *   - synthesis runs on Haiku 4.5 ($1/$5 per MTok) with a hard output cap
 * Worst case stays well under half the sale price at both tiers.
 */

import { fetchBasicPage } from "../tools/fetch-basic";
import { callClaude } from "./ai";
import type { AIServiceConfig } from "./ai";
import { searchWeb } from "./search";
import type { SearchResult } from "./search";

/** Cheap model with a hard output cap keeps the worst-case AI spend bounded. */
const RESEARCH_MODEL = "claude-haiku-4-5";
const PLAN_MAX_TOKENS = 400;
const SYNTHESIS_MAX_TOKENS = 2000;

export interface DeepResearchTier {
    /** Sub-questions to research (one SerpAPI call each). */
    subQuestions: number;
    /** Maximum sources fetched and passed to synthesis. */
    maxSources: number;
    /** Per-source character cap fed to the model. */
    charsPerSource: number;
}

/** Bounds per depth tier. Changing these changes the cost floor — reprice too. */
export const DEEP_RESEARCH_TIERS: Record<"standard" | "deep", DeepResearchTier> = {
    standard: { subQuestions: 3, maxSources: 8, charsPerSource: 5000 },
    deep: { subQuestions: 5, maxSources: 12, charsPerSource: 5000 },
};

export interface ResearchCitation { index: number; url: string; title: string; subQuestion: string }

export interface DeepResearchResult {
    query: string;
    depth: "standard" | "deep";
    subQuestions: string[];
    answer: string;
    keyFindings: string[];
    citations: ResearchCitation[];
    gaps: string[];
    sourcesFetched: number;
}

interface DeepResearchOptions {
    query: string;
    depth: "standard" | "deep";
    aiConfig: AIServiceConfig;
    serpApiKey?: string;
}

/** Ask the model to decompose the question. Falls back to the raw query. */
async function planSubQuestions(
    query: string,
    count: number,
    aiConfig: AIServiceConfig,
): Promise<string[]> {
    const systemPrompt = `You break a research question into distinct, independently searchable sub-questions.
Each sub-question must target a different facet — never rephrase the same one.
Respond with valid JSON only: {"subQuestions": ["...", "..."]}`;

    const prompt = `Research question: ${query}

Produce exactly ${String(count)} sub-questions, each written as a web search query.

Respond ONLY with valid JSON.`;

    try {
        const raw = await callClaude(
            { ...aiConfig, model: RESEARCH_MODEL, maxTokens: PLAN_MAX_TOKENS },
            prompt,
            systemPrompt,
        );
        const parsed = JSON.parse(raw) as { subQuestions?: unknown };
        const list = Array.isArray(parsed.subQuestions)
            ? parsed.subQuestions.filter((q): q is string => typeof q === "string" && q.trim() !== "")
            : [];
        return list.length > 0 ? list.slice(0, count) : [query];
    } catch {
        // Planning is an optimisation, not a requirement — research the
        // question as asked rather than failing the paid request.
        return [query];
    }
}

export async function deepResearch(options: DeepResearchOptions): Promise<DeepResearchResult> {
    const { query, depth, aiConfig, serpApiKey } = options;
    const tier = DEEP_RESEARCH_TIERS[depth];

    // 1. Plan.
    const subQuestions = await planSubQuestions(query, tier.subQuestions, aiConfig);

    // 2. One search per sub-question, in parallel.
    const searches = await Promise.allSettled(
        subQuestions.map((sub) => searchWeb({ query: sub, limit: 5, serpApiKey })),
    );

    // 3. Collect results, deduping by URL and remembering which sub-question
    //    surfaced each one.
    const seen = new Set<string>();
    const candidates: { result: SearchResult; subQuestion: string }[] = [];
    searches.forEach((outcome, i) => {
        if (outcome.status !== "fulfilled") { return; }
        const subQuestion = subQuestions[i] ?? query;
        for (const result of outcome.value) {
            if (candidates.length >= tier.maxSources) { break; }
            if (!result.url || seen.has(result.url)) { continue; }
            seen.add(result.url);
            candidates.push({ result, subQuestion });
        }
    });

    if (candidates.length === 0) {
        throw new Error("No web sources found for this query");
    }

    // 4. Fetch the sources; a failed fetch degrades to its search snippet so
    //    the source stays citable.
    const fetched = await Promise.allSettled(
        candidates.map((c) => fetchBasicPage(c.result.url, 10000)),
    );

    const citations: ResearchCitation[] = [];
    const blocks: string[] = [];
    let sourcesFetched = 0;
    candidates.forEach((candidate, i) => {
        const outcome = fetched[i];
        let body: string;
        if (outcome?.status === "fulfilled") {
            body = outcome.value.content.slice(0, tier.charsPerSource);
            sourcesFetched++;
        } else {
            body = candidate.result.snippet;
        }
        const index = citations.length + 1;
        citations.push({
            index,
            url: candidate.result.url,
            title: candidate.result.title,
            subQuestion: candidate.subQuestion,
        });
        blocks.push(`[${String(index)}] ${candidate.result.title} (${candidate.result.url})\nRelevant to: ${candidate.subQuestion}\n${body}`);
    });

    // 5. Synthesise.
    const systemPrompt = `You are a research analyst. Answer the question using ONLY the provided sources.
Cite every factual claim inline with bracketed indices like [1] or [2][3].
Where sources disagree, say so and cite both. Never invent a citation index.
Respond with valid JSON only:
{"answer": "Full answer with inline [n] citations.",
 "keyFindings": ["finding 1", "finding 2"],
 "gaps": ["what the sources did not establish"]}`;

    const prompt = `Research question: ${query}

Sub-questions investigated:
${subQuestions.map((s, i) => `${String(i + 1)}. ${s}`).join("\n")}

Sources:
${blocks.join("\n\n")}

Write a thorough, well-organised answer to the research question. Note any
gaps the sources did not cover.

Respond ONLY with valid JSON.`;

    const raw = await callClaude(
        { ...aiConfig, model: RESEARCH_MODEL, maxTokens: SYNTHESIS_MAX_TOKENS },
        prompt,
        systemPrompt,
    );

    let answer = raw;
    let keyFindings: string[] = [];
    let gaps: string[] = [];
    try {
        const parsed = JSON.parse(raw) as { answer?: string; keyFindings?: unknown; gaps?: unknown };
        if (typeof parsed.answer === "string" && parsed.answer !== "") {
            answer = parsed.answer;
        }
        if (Array.isArray(parsed.keyFindings)) {
            keyFindings = parsed.keyFindings.filter((f): f is string => typeof f === "string");
        }
        if (Array.isArray(parsed.gaps)) {
            gaps = parsed.gaps.filter((g): g is string => typeof g === "string");
        }
    } catch {
        // Model returned prose — serve it with the citation list intact.
    }

    return { query, depth, subQuestions, answer, keyFindings, citations, gaps, sourcesFetched };
}
