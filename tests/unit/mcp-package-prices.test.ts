/**
 * The standalone `@weblens/mcp` package advertises prices to agents, but it is
 * published separately and cannot import the Worker's config — so its PRICE
 * table is a hand-maintained copy of `src/config.ts` PRICING.
 *
 * A hand-maintained copy drifts. When it does, the npm package quotes a price
 * the API does not charge, and an agent budgeting from the tool description
 * gets a different number in the 402. This reads the package source and pins
 * every entry against the real config.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PRICING } from "../../src/config";

const SOURCE = fileURLToPath(new URL("../../mcp-server/src/index.ts", import.meta.url));

/** Every key of the package's PRICE table -> the config value it must equal. */
const EXPECTED: Record<string, string> = {
    fetchBasic: PRICING.fetch.basic,
    fetchPro: PRICING.fetch.pro,
    fetchResilient: PRICING.fetch.resilient,
    screenshot: PRICING.screenshot,
    search: PRICING.search,
    searchNews: PRICING.searchVerticals.news,
    searchImages: PRICING.searchVerticals.images,
    searchPlaces: PRICING.searchVerticals.places,
    searchShopping: PRICING.searchVerticals.shopping,
    searchScholar: PRICING.searchVerticals.scholar,
    searchAutocomplete: PRICING.searchVerticals.autocomplete,
    searchTrends: PRICING.searchVerticals.trends,
    youtubeTranscript: PRICING.youtubeTranscript,
    contentsPerUrl: PRICING.contents.perUrl,
    answer: PRICING.answer,
    extract: PRICING.extract,
    smartExtract: PRICING.smartExtract,
    research: PRICING.research,
    deepResearchStandard: PRICING.deepResearch.standard,
    deepResearchDeep: PRICING.deepResearch.deep,
    pdf: PRICING.pdf,
    compare: PRICING.compare,
    batchFetchPerUrl: PRICING.batchFetch.perUrl,
    map: PRICING.map,
    crawlPerPage: PRICING.crawl.perPage,
    monitorSetup: PRICING.monitor.setup,
    memoryWrite: PRICING.memory.write,
    intelCompany: PRICING.intel.company,
    intelMarket: PRICING.intel.market,
    intelCompetitive: PRICING.intel.competitive,
    intelSiteAudit: PRICING.intel.siteAudit,
};

/** Pull the `const PRICE = { ... }` literal out of the package source. */
function readPackagePrices(): Record<string, string> {
    const source = readFileSync(SOURCE, "utf8");
    const block = /const PRICE = \{([\s\S]*?)\} as const;/u.exec(source);
    if (!block) { throw new Error("PRICE table not found in mcp-server/src/index.ts"); }

    const prices: Record<string, string> = {};
    for (const [, key, value] of block[1].matchAll(/(\w+):\s*"([^"]+)"/gu)) {
        prices[key] = value;
    }
    return prices;
}

describe("@weblens/mcp price table", () => {
    const packagePrices = readPackagePrices();

    it("quotes the same price the API charges", () => {
        const drift = Object.entries(EXPECTED)
            .filter(([key, expected]) => packagePrices[key] !== expected)
            .map(([key, expected]) => `${key}: package="${packagePrices[key] ?? "MISSING"}" config="${expected}"`);

        expect(drift, `mcp-server/src/index.ts is out of sync with src/config.ts:\n${drift.join("\n")}`).toEqual([]);
    });

    it("advertises no price the config does not define", () => {
        const orphans = Object.keys(packagePrices).filter((key) => !(key in EXPECTED));
        expect(orphans, `unmapped PRICE keys: ${orphans.join(", ")}`).toEqual([]);
    });
});
