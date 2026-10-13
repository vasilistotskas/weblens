/**
 * Catalog identity (`serviceName`/`tags`/`iconUrl`) and the CDP bootstrap gate.
 *
 * Why these matter together: a resource only enters CDP's Bazaar after the CDP
 * facilitator itself settles a payment for it, and indexing is per-resource
 * (docs.cdp.coinbase.com/x402/seller/get-discovered). The catalog record is
 * written at settle time, so metadata has to be correct *before* a route is
 * seeded — otherwise refreshing it costs another payment per route.
 *
 * The gate is the mechanism that makes seeding possible without pointing every
 * buyer at CDP, whose Base-mainnet /settle is still unreliable
 * (x402-foundation/x402#1065).
 */

import { describe, expect, it } from "vitest";
import { SERVICE_ICON_PATH, SERVICE_NAME } from "../../src/config";
import { ENDPOINTS } from "../../src/endpoints";
import { catalogIconUrl, wantsCdpBootstrap } from "../../src/middleware/payment";
import type { Env } from "../../src/types";

const envWith = (secret?: string): Env =>
    ({ BAZAAR_BOOTSTRAP_SECRET: secret } as unknown as Env);

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

describe("CDP bootstrap gate", () => {
    it("fails closed when no secret is configured", () => {
        // Without this, anyone could force settlement through CDP.
        expect(wantsCdpBootstrap(envWith(undefined), "anything")).toBe(false);
        expect(wantsCdpBootstrap(envWith(""), "anything")).toBe(false);
    });

    it("ignores a missing header even when a secret is configured", () => {
        expect(wantsCdpBootstrap(envWith("s3cret"), undefined)).toBe(false);
    });

    it("rejects a wrong secret, including length-mismatched ones", () => {
        expect(wantsCdpBootstrap(envWith("s3cret"), "wrong")).toBe(false);
        expect(wantsCdpBootstrap(envWith("s3cret"), "s3cre")).toBe(false);
        expect(wantsCdpBootstrap(envWith("s3cret"), "s3cretx")).toBe(false);
        expect(wantsCdpBootstrap(envWith("s3cret"), "S3CRET")).toBe(false);
    });

    it("accepts an exact match", () => {
        expect(wantsCdpBootstrap(envWith("s3cret"), "s3cret")).toBe(true);
    });
});
