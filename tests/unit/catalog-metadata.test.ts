/**
 * Catalog identity (`serviceName`/`tags`/`iconUrl`).
 *
 * A resource only enters CDP's Bazaar after the CDP facilitator itself settles
 * a payment for it, and indexing is per-resource
 * (docs.cdp.coinbase.com/x402/seller/get-discovered). The catalog record is
 * written at settle time, so metadata has to be correct *before* a route is
 * paid — otherwise refreshing it costs another payment per route.
 */

import { describe, expect, it } from "vitest";
import { SERVICE_ICON_PATH, SERVICE_NAME } from "../../src/config";
import { ENDPOINTS } from "../../src/endpoints";
import { catalogIconUrl } from "../../src/middleware/payment";

describe("catalog tags", () => {
    it("gives every paid endpoint a non-empty tag set", () => {
        // A new paid endpoint must not ship untagged: agents search facilitator
        // catalogs by intent, and an untagged resource is effectively unfindable.
        const untagged = ENDPOINTS.filter((e) => e.catalogTags.length === 0).map((e) => e.path);
        expect(untagged).toEqual([]);
    });

    it("exposes a service name and a relative icon path", () => {
        expect(SERVICE_NAME).toBe("WebLens");
        // Relative so each deployment advertises its own reachable origin.
        expect(SERVICE_ICON_PATH.startsWith("/")).toBe(true);
    });
});

describe("catalog icon url", () => {
    it("publishes https for a public host even when the request arrives over http", () => {
        // `wrangler dev` reports the configured route host over plain http, so
        // deriving the scheme from the request would publish an http icon and
        // fail facilitator curation.
        expect(catalogIconUrl("http://api.weblens.dev/search/places"))
            .toBe("https://api.weblens.dev/favicon.png");
        expect(catalogIconUrl("https://api.weblens.dev/search/places"))
            .toBe("https://api.weblens.dev/favicon.png");
    });

    it("tracks the serving origin rather than hardcoding production", () => {
        expect(catalogIconUrl("https://weblens-testnet.workers.dev/fetch/basic"))
            .toBe("https://weblens-testnet.workers.dev/favicon.png");
    });

    it("leaves a local dev origin on http so the icon stays fetchable", () => {
        expect(catalogIconUrl("http://127.0.0.1:8787/fetch/basic"))
            .toBe("http://127.0.0.1:8787/favicon.png");
        expect(catalogIconUrl("http://localhost:8787/fetch/basic"))
            .toBe("http://localhost:8787/favicon.png");
    });
});
