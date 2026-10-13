/**
 * How a SerpApi answer becomes results or an error, for every SerpApi-backed
 * endpoint. SerpApi reports a search with no matches as status "Success" with
 * the message in a top-level `error` (serpapi.com/search-errors): treating
 * that as a failure answered "no results" with a 502 "provider temporarily
 * unavailable" (/search/shopping's own published example did that).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { searchShopping, SearchUpstreamError } from "../../src/services/search";

function serpApiAnswers(body: unknown): void {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }));
}

describe("SerpApi results", () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it("answers a search with no matches with no results, not an error", async () => {
        serpApiAnswers({
            search_metadata: { status: "Success" },
            search_information: { shopping_results_state: "Fully empty" },
            error: "Google hasn't returned any results for this query.",
        });
        await expect(searchShopping("x402 payment protocol", 10, "key")).resolves.toEqual([]);
    });

    it("still fails a search SerpApi itself failed", async () => {
        serpApiAnswers({ search_metadata: { status: "Error" }, error: "Proxy timed out" });
        await expect(searchShopping("mechanical keyboard", 10, "key")).rejects.toBeInstanceOf(SearchUpstreamError);
    });

    it("maps the results of a search that found matches", async () => {
        serpApiAnswers({
            search_metadata: { status: "Success" },
            shopping_results: [{ title: "Keychron K2", price: "$79.00", source: "Keychron", link: "https://example.com/k2" }],
        });
        const results = await searchShopping("mechanical keyboard", 10, "key");
        expect(results).toHaveLength(1);
        expect(results[0]?.title).toBe("Keychron K2");
    });
});
