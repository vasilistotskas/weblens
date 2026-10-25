// Loads the main Worker before each test file runs. `exports.default.fetch()` otherwise imports it on the
// first call, which under the full suite's parallel load takes longer than a test's 5 s timeout
// (developers.cloudflare.com/workers/testing/vitest-integration/migration-guides/migrate-from-unstable-dev/
// imports the main module the same way).
import "../../src/index";
import { FACILITATOR_URLS } from "../../src/config";
import payaiSupported from "./fixtures/payai-supported.json";

// No workers test may depend on the network. Every 402 needs the facilitator's /supported answer (CDP is
// skipped without credentials, so that is PayAI's) and /health probes the facilitator, so both are served
// here: /supported from PayAI's answer recorded on 2026-10-25, the probe with a 200. A live facilitator
// that was slow once timed a CI run out. Any other request a test did not mock fails, naming its URL.
//
// This replaces fetch itself rather than installing a vi spy, so a test's own `vi.spyOn(globalThis, "fetch")`
// sits on top of it and `vi.restoreAllMocks()` returns to it.
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(new Request(input, init).url);
    if (url.origin === FACILITATOR_URLS.payai) {
        return Promise.resolve(url.pathname === "/supported" ? Response.json(payaiSupported) : new Response("ok"));
    }
    return Promise.reject(new Error(`Unmocked outbound request in a workers test: ${url.origin}${url.pathname}`));
};
