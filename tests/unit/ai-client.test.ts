/**
 * The one Claude client every AI endpoint goes through.
 *
 * /extract once hardcoded a model Anthropic later retired, and every paid
 * call failed for months; the model now comes from AI_MODEL alone. The client
 * must also read the reply's text block rather than the first block, since a
 * model that thinks puts a thinking block first.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_MODEL, PAID_UPSTREAMS } from "../../src/config";
import { AIUnavailableError, callClaude } from "../../src/services/ai";

interface SentBody { model: string; max_tokens: number; thinking?: { type: string } }

function anthropicAnswers(status: number, body: unknown): { sent: () => SentBody; url: () => string } {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status }));
    const call = () => spy.mock.calls[0] ?? [];
    return {
        sent: () => JSON.parse(call()[1]?.body as string) as SentBody,
        url: () => { const input = call()[0]; return input instanceof Request ? input.url : input?.toString() ?? ""; },
    };
}

describe("callClaude", () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it("asks AI_MODEL, with thinking off and the caller's output cap", async () => {
        const api = anthropicAnswers(200, { content: [{ type: "text", text: "{}" }] });
        await callClaude({ apiKey: "k", maxTokens: 321 }, "prompt");

        expect(api.url()).toBe(PAID_UPSTREAMS.anthropicMessages);
        expect(api.sent()).toMatchObject({ model: AI_MODEL, max_tokens: 321, thinking: { type: "disabled" } });
    });

    it("returns the text block even when another block comes first, without code fences", async () => {
        anthropicAnswers(200, { content: [
            { type: "thinking", thinking: "..." },
            { type: "text", text: "```json\n{\"title\":\"Example\"}\n```" },
        ] });

        await expect(callClaude({ apiKey: "k" }, "prompt")).resolves.toBe("{\"title\":\"Example\"}");
    });

    it("reports a retired or unknown model as the AI being unavailable", async () => {
        anthropicAnswers(404, { type: "error", error: { type: "not_found_error" } });

        await expect(callClaude({ apiKey: "k" }, "prompt")).rejects.toBeInstanceOf(AIUnavailableError);
    });
});
