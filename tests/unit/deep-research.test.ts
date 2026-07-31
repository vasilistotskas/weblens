/**
 * Deep research orchestration: sub-question planning, per-question search,
 * cross-question dedupe, source-cap enforcement, citation numbering, and
 * graceful degradation when a step fails.
 *
 * The tier bounds are also the cost model — `standard` is priced assuming at
 * most 3 SerpAPI calls and 8 sources, `deep` at most 5 and 12. A regression
 * that raised either would silently sell below cost, so the caps are asserted
 * here as well as documented in config.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEEP_RESEARCH_TIERS } from "../../src/services/deep-research";
import { PRICING } from "../../src/config";

const searchWeb = vi.fn();
const fetchBasicPage = vi.fn();
const callClaude = vi.fn();

vi.mock("../../src/services/search", () => ({
    searchWeb: (...args: unknown[]) => searchWeb(...args) as unknown,
}));
vi.mock("../../src/tools/fetch-basic", () => ({
    fetchBasicPage: (...args: unknown[]) => fetchBasicPage(...args) as unknown,
}));
vi.mock("../../src/services/ai", () => ({
    callClaude: (...args: unknown[]) => callClaude(...args) as unknown,
    AIUnavailableError: class extends Error {},
}));

const aiConfig = { apiKey: "test-key" };

/** n search results whose URLs are unique to `tag`. */
function results(tag: string, n: number) {
    return Array.from({ length: n }, (_, i) => ({
        title: `${tag} result ${String(i)}`,
        url: `https://${tag}.test/${String(i)}`,
        snippet: `snippet ${String(i)}`,
        position: i + 1,
    }));
}

/** callClaude is used twice: first to plan, then to synthesize. */
function mockClaude(subQuestions: string[], synthesis: Record<string, unknown>) {
    callClaude
        .mockResolvedValueOnce(JSON.stringify({ subQuestions }))
        .mockResolvedValueOnce(JSON.stringify(synthesis));
}

// resetAllMocks (not clearAllMocks) — only reset drains the
// `mockResolvedValueOnce` queue. A test whose run throws before consuming
// both queued values would otherwise leak the leftover into the next test.
beforeEach(() => {
    vi.resetAllMocks();
    fetchBasicPage.mockResolvedValue({ content: "page body", title: "T", url: "u", metadata: {}, tier: "basic", fetchedAt: "" });
});
afterEach(() => { vi.resetAllMocks(); });

async function run(depth: "standard" | "deep" = "standard") {
    const { deepResearch } = await import("../../src/services/deep-research");
    return deepResearch({ query: "test question", depth, aiConfig });
}

describe("deep research tiers", () => {
    it("keeps each tier inside the bounds its price assumes", () => {
        expect(DEEP_RESEARCH_TIERS.standard.subQuestions).toBeLessThanOrEqual(3);
        expect(DEEP_RESEARCH_TIERS.standard.maxSources).toBeLessThanOrEqual(8);
        expect(DEEP_RESEARCH_TIERS.deep.subQuestions).toBeLessThanOrEqual(5);
        expect(DEEP_RESEARCH_TIERS.deep.maxSources).toBeLessThanOrEqual(12);
    });

    it("prices every tier above its worst-case upstream cost", () => {
        const SERP_PER_CALL = 0.015; // worst-case plan rate
        const AI_CEILING = 0.03;     // capped Haiku planning + synthesis
        for (const [name, tier] of Object.entries(DEEP_RESEARCH_TIERS)) {
            const worstCase = tier.subQuestions * SERP_PER_CALL + AI_CEILING;
            const price = parseFloat(
                PRICING.deepResearch[name as "standard" | "deep"].replace("$", ""),
            );
            expect(price, `${name} must be priced above cost`).toBeGreaterThan(worstCase);
        }
    });
});

describe("deepResearch", () => {
    it("plans sub-questions and searches each one", async () => {
        mockClaude(["q one", "q two", "q three"], { answer: "A [1]", keyFindings: ["k"], gaps: [] });
        searchWeb.mockResolvedValue(results("a", 2));

        const result = await run();

        expect(result.subQuestions).toEqual(["q one", "q two", "q three"]);
        expect(searchWeb).toHaveBeenCalledTimes(3);
        expect(searchWeb.mock.calls.map((c) => (c[0] as { query: string }).query))
            .toEqual(["q one", "q two", "q three"]);
    });

    it("dedupes sources that several sub-questions return", async () => {
        mockClaude(["q1", "q2"], { answer: "A", keyFindings: [], gaps: [] });
        searchWeb.mockResolvedValue(results("same", 3)); // identical URLs each time

        const result = await run();

        expect(result.citations).toHaveLength(3);
        expect(new Set(result.citations.map((c) => c.url)).size).toBe(3);
    });

    it("never exceeds the tier source cap", async () => {
        mockClaude(["q1", "q2", "q3"], { answer: "A", keyFindings: [], gaps: [] });
        searchWeb
            .mockResolvedValueOnce(results("a", 5))
            .mockResolvedValueOnce(results("b", 5))
            .mockResolvedValueOnce(results("c", 5));

        const result = await run("standard");

        expect(result.citations.length).toBeLessThanOrEqual(DEEP_RESEARCH_TIERS.standard.maxSources);
    });

    it("numbers citations from 1 with no gaps", async () => {
        mockClaude(["q1"], { answer: "A", keyFindings: [], gaps: [] });
        searchWeb.mockResolvedValue(results("a", 4));

        const result = await run();

        expect(result.citations.map((c) => c.index)).toEqual([1, 2, 3, 4]);
    });

    it("records which sub-question surfaced each source", async () => {
        mockClaude(["alpha", "beta"], { answer: "A", keyFindings: [], gaps: [] });
        searchWeb
            .mockResolvedValueOnce(results("a", 1))
            .mockResolvedValueOnce(results("b", 1));

        const result = await run();

        expect(result.citations[0]?.subQuestion).toBe("alpha");
        expect(result.citations[1]?.subQuestion).toBe("beta");
    });

    it("truncates each source to the tier cap before synthesis", async () => {
        mockClaude(["q1"], { answer: "A", keyFindings: [], gaps: [] });
        searchWeb.mockResolvedValue(results("a", 1));
        fetchBasicPage.mockResolvedValue({
            content: "x".repeat(50_000), title: "T", url: "u", metadata: {}, tier: "basic", fetchedAt: "",
        });

        await run();

        const synthesisPrompt = callClaude.mock.calls[1]?.[1] as string;
        // The whole prompt must stay near the per-source cap, not the raw 50k.
        expect(synthesisPrompt.length).toBeLessThan(DEEP_RESEARCH_TIERS.standard.charsPerSource + 2000);
    });

    it("keeps a source citable when its fetch fails, using the snippet", async () => {
        mockClaude(["q1"], { answer: "A", keyFindings: [], gaps: [] });
        searchWeb.mockResolvedValue(results("a", 2));
        fetchBasicPage
            .mockRejectedValueOnce(new Error("timeout"))
            .mockResolvedValueOnce({ content: "ok", title: "T", url: "u", metadata: {}, tier: "basic", fetchedAt: "" });

        const result = await run();

        expect(result.citations).toHaveLength(2);
        expect(result.sourcesFetched).toBe(1);
        expect(callClaude.mock.calls[1]?.[1] as string).toContain("snippet 0");
    });

    it("continues when one sub-question's search fails", async () => {
        mockClaude(["q1", "q2"], { answer: "A", keyFindings: [], gaps: [] });
        searchWeb
            .mockRejectedValueOnce(new Error("serp down"))
            .mockResolvedValueOnce(results("b", 2));

        const result = await run();

        expect(result.citations).toHaveLength(2);
    });

    it("falls back to the raw query when planning fails", async () => {
        callClaude
            .mockResolvedValueOnce("not json at all")
            .mockResolvedValueOnce(JSON.stringify({ answer: "A", keyFindings: [], gaps: [] }));
        searchWeb.mockResolvedValue(results("a", 1));

        const result = await run();

        expect(result.subQuestions).toEqual(["test question"]);
        expect(searchWeb).toHaveBeenCalledTimes(1);
    });

    it("serves prose when synthesis is not valid JSON", async () => {
        callClaude
            .mockResolvedValueOnce(JSON.stringify({ subQuestions: ["q1"] }))
            .mockResolvedValueOnce("A plain prose answer about the topic.");
        searchWeb.mockResolvedValue(results("a", 1));

        const result = await run();

        expect(result.answer).toBe("A plain prose answer about the topic.");
        expect(result.citations).toHaveLength(1);
    });

    it("throws when no sources are found at all", async () => {
        mockClaude(["q1"], { answer: "A", keyFindings: [], gaps: [] });
        searchWeb.mockResolvedValue([]);

        await expect(run()).rejects.toThrow(/No web sources/u);
    });

    it("returns findings and gaps from the synthesis", async () => {
        mockClaude(["q1"], { answer: "A [1]", keyFindings: ["f1", "f2"], gaps: ["g1"] });
        searchWeb.mockResolvedValue(results("a", 1));

        const result = await run();

        expect(result.keyFindings).toEqual(["f1", "f2"]);
        expect(result.gaps).toEqual(["g1"]);
    });
});
