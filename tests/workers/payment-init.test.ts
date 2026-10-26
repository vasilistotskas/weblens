/**
 * The payment wall's one `/supported` sync per isolate.
 *
 * Production cancelled requests with process.exit(1) (2026-10-25): every route
 * middleware ran its own `initialize()` on the one shared resource server, and
 * `initialize()` empties the supported-kinds map before refilling it, so
 * concurrent first requests on different routes validated against an empty
 * map and @x402/core exited on the RouteConfigurationError. Dynamically priced
 * routes rebuilt their middleware, and refetched `/supported`, on every request.
 *
 * This file's module state starts unsynced (each test file gets its own), which
 * is what the first wave of concurrent requests needs.
 */

import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FACILITATOR_URLS } from "../../src/config";
import { PAID_ENDPOINTS } from "../../src/endpoints";

// tests/workers/setup.ts's fetch, which answers the facilitator from its recording.
const recordedFetch = globalThis.fetch;

/** Count `/supported` calls; fail the first `failures` of them, delay the rest. */
function facilitator({ failures = 0, delayMs = 0 } = {}) {
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = new URL(new Request(input, init).url);
        if (url.origin === FACILITATOR_URLS.payai && url.pathname === "/supported") {
            calls += 1;
            if (calls <= failures) {
                return new Response("unavailable", { status: 503 });
            }
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        return recordedFetch(input, init);
    });
    return { supportedCalls: () => calls };
}

function probe(path: string) {
    return exports.default.fetch(`https://api.weblens.dev${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
    });
}

describe("payment wall initialization", () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it("syncs once for concurrent first requests on every route, and never again per request", async () => {
        const { supportedCalls } = facilitator({ delayMs: 20 });
        const statuses = await Promise.all(PAID_ENDPOINTS.map(async (path) => (await probe(path)).status));
        expect(statuses.every((status) => status === 402)).toBe(true);
        // One sync: the Base and the Solana chain each ask PayAI once.
        const afterFirstWave = supportedCalls();
        expect(afterFirstWave).toBe(2);

        // A dynamically priced route builds a fresh middleware per request; it must reuse the sync.
        for (let i = 0; i < 3; i++) {
            expect((await probe("/fetch/pro")).status).toBe(402);
        }
        expect(supportedCalls()).toBe(afterFirstWave);
    });
});
