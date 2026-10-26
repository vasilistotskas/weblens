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
 * A sync that fails must not stay cached or end the process. Tests run in
 * order and share this file's module state: a failed sync evicts the caches,
 * so each test starts from an unsynced server.
 */

import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FACILITATOR_URLS } from "../../src/config";

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

describe("payment wall initialization failures", () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it("answers 503, without exiting, while no facilitator answers /supported", async () => {
        facilitator({ failures: Number.MAX_SAFE_INTEGER });
        const res = await probe("/fetch/basic");
        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    });

    it("syncs again after a failed sync and serves the challenge", async () => {
        // Both network families (Base and Solana) ask PayAI once per sync; fail the first sync.
        const { supportedCalls } = facilitator({ failures: 2 });
        const res = await probe("/fetch/basic");
        expect(res.status).toBe(402);
        expect(supportedCalls()).toBe(4);
    });
});
