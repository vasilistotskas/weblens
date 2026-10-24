/**
 * How each search provider's answer becomes results or an error.
 *
 * Serper (Google search and its verticals) reports failures as a non-2xx
 * `{message, statusCode}`: "Not enough credits" is a 400, a bad key a 403.
 * SerpAPI (Trends, transcripts) reports a search with no matches as status
 * "Success" with the message in a top-level `error` (serpapi.com/search-errors):
 * treating that as a failure answered "no results" with a 502.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { PAID_UPSTREAMS } from "../../src/config";
import {
    SearchProviderUnavailableError,
    searchPlaces,
    searchShopping,
    searchTrends,
    SearchUpstreamError,
    searchWeb,
} from "../../src/services/search";

function providerAnswers(body: unknown, status = 200) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    );
}

describe("Serper results", () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it("posts the query to the type's endpoint with the key in X-API-KEY", async () => {
        const spy = providerAnswers({ organic: [] });
        await searchWeb({ query: "x402", limit: 5, serperApiKey: "key" });

        const [input, init] = spy.mock.calls[0] ?? [];
        expect(input).toBe(`${PAID_UPSTREAMS.serper}/search`);
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("X-API-KEY")).toBe("key");
        expect(JSON.parse(init?.body as string)).toEqual({ q: "x402", num: 5 });
    });

    it("maps organic results and numbers them from 1", async () => {
        providerAnswers({ organic: [
            { title: "x402", link: "https://x402.org", snippet: "Payments over HTTP", position: 1 },
            { title: "Docs", link: "https://docs.x402.org", position: 2 },
        ] });
        await expect(searchWeb({ query: "x402", limit: 10, serperApiKey: "key" })).resolves.toEqual([
            { title: "x402", url: "https://x402.org", snippet: "Payments over HTTP", position: 1 },
            { title: "Docs", url: "https://docs.x402.org", snippet: "", position: 2 },
        ]);
    });

    it("maps Serper's place fields onto the published shape", async () => {
        providerAnswers({ places: [{
            title: "Whole Foods Market", address: "2001 Market St", latitude: 37.76, longitude: -122.42,
            rating: 4.2, ratingCount: 1500, category: "Grocery store", phoneNumber: "(415) 626-1430",
            website: "https://www.wholefoodsmarket.com", cid: "6353588238324409422",
        }] });
        await expect(searchPlaces("whole foods", 10, "key", "San Francisco")).resolves.toEqual([{
            position: 1, name: "Whole Foods Market", address: "2001 Market St", rating: 4.2, reviews: 1500,
            category: "Grocery store", phone: "(415) 626-1430", website: "https://www.wholefoodsmarket.com",
            cid: "6353588238324409422", coordinates: { latitude: 37.76, longitude: -122.42 },
        }]);
    });

    it("answers a search with no matches with no results", async () => {
        providerAnswers({ searchParameters: { q: "zzzz" } });
        await expect(searchShopping("zzzz", 10, "key")).resolves.toEqual([]);
    });

    it("fails a call Serper refused, with Serper's reason", async () => {
        providerAnswers({ message: "Not enough credits", statusCode: 400 }, 400);
        const failure = searchWeb({ query: "x402", limit: 10, serperApiKey: "key" });
        await expect(failure).rejects.toBeInstanceOf(SearchUpstreamError);
        await expect(failure).rejects.toThrow("HTTP 400: Not enough credits");
    });

    it("never calls Serper without a key", async () => {
        const spy = providerAnswers({});
        await expect(searchWeb({ query: "x402", limit: 10 })).rejects.toBeInstanceOf(SearchProviderUnavailableError);
        expect(spy).not.toHaveBeenCalled();
    });
});

describe("SerpAPI results", () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it("answers a search with no matches with no results, not an error", async () => {
        providerAnswers({
            search_metadata: { status: "Success" },
            error: "Google hasn't returned any results for this query.",
        });
        await expect(searchTrends("zzzz", "key")).resolves.toEqual([]);
    });

    it("still fails a search SerpApi itself failed", async () => {
        providerAnswers({ search_metadata: { status: "Error" }, error: "Proxy timed out" });
        await expect(searchTrends("x402", "key")).rejects.toBeInstanceOf(SearchUpstreamError);
    });
});
