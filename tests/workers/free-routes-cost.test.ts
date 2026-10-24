/**
 * Free routes must never cost us money.
 *
 * Production ran /free/search and /s/* on SerpAPI: ~6k unpaid searches a week
 * offered against a 250/month plan that the paid search family shares. These
 * tests drive every free route that fetches anything through the real Worker
 * and fail if any outbound request reaches a host in PAID_UPSTREAMS.
 */

import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAID_UPSTREAMS } from "../../src/config";
import { PAID_ENDPOINTS } from "../../src/endpoints";

const ORIGIN = "https://api.weblens.dev";
const TARGET = "https://example.com/";
const PAID_HOSTS = new Set(Object.values(PAID_UPSTREAMS).map((u) => new URL(u).host));

let requestedHosts: string[] = [];
let ipCounter = 0;

/** A fresh RFC 5737 documentation address per request: its own rate-limit bucket. */
function freshIp(): string {
    ipCounter += 1;
    return `203.0.113.${String(ipCounter % 250)}`;
}

beforeEach(() => {
    requestedHosts = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
        const request = new Request(input, init);
        requestedHosts.push(new URL(request.url).host);
        return Promise.resolve(new Response("<html><head><title>Example</title></head><body><p>Example page</p></body></html>", {
            headers: { "Content-Type": "text/html; charset=utf-8" },
        }));
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

function paidHostsReached(): string[] {
    return requestedHosts.filter((h) => PAID_HOSTS.has(h));
}

describe("free routes reach no paid upstream", () => {
    it("intercepts the Worker's outbound fetches (positive control)", async () => {
        const res = await exports.default.fetch(`${ORIGIN}/free/fetch`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "cf-connecting-ip": freshIp() },
            body: JSON.stringify({ url: TARGET }),
        });

        expect(res.status).toBe(200);
        expect(requestedHosts).toContain(new URL(TARGET).host);
    });

    it("GET /r/{url}", async () => {
        const res = await exports.default.fetch(`${ORIGIN}/r/${TARGET}`, { headers: { "cf-connecting-ip": freshIp() } });

        expect(res.status).toBe(200);
        expect(paidHostsReached()).toEqual([]);
    });

    it("POST /free/fetch", async () => {
        await exports.default.fetch(`${ORIGIN}/free/fetch`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "cf-connecting-ip": freshIp() },
            body: JSON.stringify({ url: TARGET }),
        });

        expect(paidHostsReached()).toEqual([]);
    });

    it.each(PAID_ENDPOINTS)("POST /preview for %s, with a url", async (endpoint) => {
        await exports.default.fetch(`${ORIGIN}/preview`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "cf-connecting-ip": freshIp() },
            body: JSON.stringify({ endpoint, url: TARGET }),
        });

        expect(paidHostsReached()).toEqual([]);
    });
});
