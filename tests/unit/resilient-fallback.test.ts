/**
 * /fetch/resilient must actually fall back.
 *
 * Regression: the chain listed Firecrawl and Zyte "via x402", but that code
 * path returned "not yet implemented" on 402 and both advertised endpoints
 * 404'd — so a $0.025 endpoint delivered plain fetch plus two doomed
 * requests. The fallback tier is now Cloudflare Browser Rendering, and this
 * asserts it engages when the native tier fails, and is skipped when it
 * succeeds (the browser tier is the expensive one).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDERS, resilientFetch } from "../../src/services/provider-registry";
import type { Env } from "../../src/types";

const HTML = "<html><head><title>Rendered</title></head><body><h1>Hello</h1></body></html>";

/** Minimal puppeteer stand-in for the Browser Rendering binding. */
function stubBrowser(pageHtml = HTML) {
    const goto = vi.fn(() => Promise.resolve());
    const close = vi.fn(() => Promise.resolve());
    const page = {
        setRequestInterception: vi.fn(() => Promise.resolve()),
        on: vi.fn(),
        goto,
        content: vi.fn(() => Promise.resolve(pageHtml)),
        title: vi.fn(() => Promise.resolve("Rendered")),
    };
    const launch = vi.fn(() => Promise.resolve({ newPage: () => Promise.resolve(page), close }));
    vi.doMock("@cloudflare/puppeteer", () => ({ default: { launch } }));
    return { launch, goto, close };
}

beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });
afterEach(() => { vi.resetModules(); vi.unstubAllGlobals(); vi.doUnmock("@cloudflare/puppeteer"); });

describe("provider chain", () => {
    it("is native first, then the browser tier — with no phantom providers", () => {
        expect(PROVIDERS.map((p) => p.id)).toEqual(["weblens-native", "weblens-browser"]);
        expect(PROVIDERS.every((p) => !("x402Endpoint" in p))).toBe(true);
    });
});

describe("resilientFetch fallback", () => {
    it("uses the native tier when plain fetch succeeds and never launches a browser", async () => {
        const { launch } = stubBrowser();
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(
            new Response(HTML, { status: 200, headers: { "Content-Type": "text/html" } }),
        )));
        const { resilientFetch: fn } = await import("../../src/services/provider-registry");

        const result = await fn("https://site.test/", 10000, undefined, {} as Env);

        expect(result.provider.id).toBe("weblens-native");
        expect(result.provider.attemptsUsed).toBe(1);
        expect(launch).not.toHaveBeenCalled();
    });

    it("falls back to the browser tier when plain fetch fails", async () => {
        const { launch, close } = stubBrowser();
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("blocked", { status: 403 }))));
        const { resilientFetch: fn } = await import("../../src/services/provider-registry");

        const result = await fn("https://site.test/", 10000, undefined, { BROWSER: {} as Fetcher } as Env);

        expect(result.provider.id).toBe("weblens-browser");
        expect(result.provider.attemptsUsed).toBe(2);
        expect(result.title).toBe("Rendered");
        expect(result.content).toContain("Hello");
        expect(launch).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce(); // browser released even on success
    });

    it("reports a real error when both tiers fail, naming each tier", async () => {
        stubBrowser();
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("nope", { status: 500 }))));
        const { resilientFetch: fn } = await import("../../src/services/provider-registry");

        // No BROWSER binding → the browser tier reports unavailability rather
        // than silently pretending to have tried something.
        await expect(fn("https://site.test/", 10000, undefined, {} as Env))
            .rejects.toThrow(/WebLens Native.*WebLens Browser/su);
    });
});
