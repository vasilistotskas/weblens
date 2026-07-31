/**
 * /crawl orchestration: BFS depth, page budget, robots enforcement, dedupe,
 * same-host containment, and per-page failure isolation.
 *
 * `fetch` is stubbed with a small fake site so the crawl is deterministic and
 * CI stays offline. safeFetch (which the handler uses) delegates to global
 * fetch, so stubbing here exercises the real handler path including redirect
 * validation and content-type gating.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crawlHandler } from "../../src/tools/crawl";

type Handler = Parameters<typeof crawlHandler>[0];

interface CrawlBody {
    url: string; limit?: number; maxDepth?: number; include?: string[]; exclude?: string[];
    respectRobots?: boolean; maxChars?: number; timeout?: number;
}

interface CrawlPage { url: string; depth: number; status: string; title?: string; content?: string; error?: string }
interface CrawlResponse {
    url: string;
    pages: CrawlPage[];
    summary: { crawled: number; successful: number; failed: number; discovered: number; robotsRespected: boolean };
}

/** Defaults mirror CrawlRequestSchema so the handler sees a parsed body. */
function ctx(body: CrawlBody) {
    const validated = {
        limit: 10, maxDepth: 2, include: [], exclude: [],
        respectRobots: true, maxChars: 8000, timeout: 10000,
        ...body,
    };
    const vars = new Map<string, unknown>([["requestId", "req_test"], ["validatedBody", validated]]);
    return {
        env: {},
        get: (k: string) => vars.get(k),
        set: (k: string, v: unknown) => vars.set(k, v),
        json: (payload: unknown, status?: number) => ({ payload, status: status ?? 200 }),
    } as unknown as Handler;
}

async function runCrawl(body: CrawlBody) {
    const res = await crawlHandler(ctx(body)) as unknown as { payload: unknown; status: number };
    return { status: res.status, body: res.payload as CrawlResponse & { code?: string } };
}

function html(links: string[], title = "Page") {
    const anchors = links.map((l) => `<a href="${l}">l</a>`).join("");
    return `<html><head><title>${title}</title></head><body><h1>${title}</h1>${anchors}</body></html>`;
}

/** A fake site: path -> html. Anything unlisted 404s. */
function stubSite(pages: Record<string, string>, robots?: string) {
    vi.stubGlobal("fetch", vi.fn((input: string | URL) => {
        const url = new URL(typeof input === "string" ? input : input.href);
        if (url.pathname === "/robots.txt") {
            return Promise.resolve(robots === undefined
                ? new Response("", { status: 404 })
                : new Response(robots, { status: 200, headers: { "Content-Type": "text/plain" } }));
        }
        const key = url.pathname;
        const page = pages[key];
        if (page === undefined) {
            return Promise.resolve(new Response("nope", { status: 404 }));
        }
        return Promise.resolve(new Response(page, { status: 200, headers: { "Content-Type": "text/html" } }));
    }));
}

beforeEach(() => { vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("crawlHandler", () => {
    it("crawls breadth-first and returns markdown per page", async () => {
        stubSite({
            "/": html(["/a", "/b"], "Home"),
            "/a": html([], "A"),
            "/b": html([], "B"),
        });
        const { status, body } = await runCrawl({ url: "https://site.test/" });

        expect(status).toBe(200);
        expect(body.summary.successful).toBe(3);
        expect(body.pages.map((p) => p.url).sort()).toEqual([
            "https://site.test/", "https://site.test/a", "https://site.test/b",
        ]);
        expect(body.pages.find((p) => p.url === "https://site.test/a")?.content).toContain("A");
        expect(body.pages.find((p) => p.url === "https://site.test/")?.depth).toBe(0);
        expect(body.pages.find((p) => p.url === "https://site.test/a")?.depth).toBe(1);
    });

    it("honours the page budget", async () => {
        stubSite({
            "/": html(["/a", "/b", "/c", "/d"], "Home"),
            "/a": html([], "A"), "/b": html([], "B"), "/c": html([], "C"), "/d": html([], "D"),
        });
        const { body } = await runCrawl({ url: "https://site.test/", limit: 2 });
        expect(body.pages).toHaveLength(2);
    });

    it("stops at maxDepth", async () => {
        stubSite({
            "/": html(["/a"], "Home"),
            "/a": html(["/deep"], "A"),
            "/deep": html([], "Deep"),
        });
        const { body } = await runCrawl({ url: "https://site.test/", maxDepth: 1 });
        expect(body.pages.map((p) => p.url)).not.toContain("https://site.test/deep");
        expect(body.pages).toHaveLength(2);
    });

    it("maxDepth 0 fetches only the start page", async () => {
        stubSite({ "/": html(["/a"], "Home"), "/a": html([], "A") });
        const { body } = await runCrawl({ url: "https://site.test/", maxDepth: 0 });
        expect(body.pages).toHaveLength(1);
        expect(body.pages[0]?.url).toBe("https://site.test/");
    });

    it("never leaves the start host", async () => {
        stubSite({ "/": html(["https://evil.test/x", "/ok"], "Home"), "/ok": html([], "OK") });
        const { body } = await runCrawl({ url: "https://site.test/" });
        expect(body.pages.every((p) => p.url.startsWith("https://site.test/"))).toBe(true);
    });

    it("does not visit the same URL twice", async () => {
        stubSite({
            "/": html(["/a", "/a/", "/a#frag"], "Home"),
            "/a": html(["/"], "A"),
        });
        const { body } = await runCrawl({ url: "https://site.test/" });
        const urls = body.pages.map((p) => p.url);
        expect(new Set(urls).size).toBe(urls.length);
        expect(urls).toHaveLength(2);
    });

    it("returns 403 when robots.txt disallows the start URL", async () => {
        stubSite({ "/private": html([], "P") }, "User-agent: *\nDisallow: /private");
        const { status, body } = await runCrawl({ url: "https://site.test/private" });
        expect(status).toBe(403);
        expect(body.code).toBe("FORBIDDEN");
    });

    it("skips robots-disallowed links but keeps crawling the rest", async () => {
        stubSite({
            "/": html(["/admin", "/public"], "Home"),
            "/admin": html([], "Admin"),
            "/public": html([], "Public"),
        }, "User-agent: *\nDisallow: /admin");
        const { body } = await runCrawl({ url: "https://site.test/" });
        const urls = body.pages.map((p) => p.url);
        expect(urls).toContain("https://site.test/public");
        expect(urls).not.toContain("https://site.test/admin");
    });

    it("crawls disallowed paths when respectRobots is false", async () => {
        stubSite({
            "/": html(["/admin"], "Home"),
            "/admin": html([], "Admin"),
        }, "User-agent: *\nDisallow: /admin");
        const { body } = await runCrawl({ url: "https://site.test/", respectRobots: false });
        expect(body.pages.map((p) => p.url)).toContain("https://site.test/admin");
        expect(body.summary.robotsRespected).toBe(false);
    });

    it("records per-page failures without aborting the crawl", async () => {
        stubSite({ "/": html(["/missing", "/ok"], "Home"), "/ok": html([], "OK") });
        const { body } = await runCrawl({ url: "https://site.test/" });
        expect(body.summary.failed).toBe(1);
        expect(body.summary.successful).toBe(2);
        expect(body.pages.find((p) => p.url === "https://site.test/missing")?.status).toBe("failed");
    });

    it("applies include/exclude path filters", async () => {
        stubSite({
            "/": html(["/blog/a", "/docs/b"], "Home"),
            "/blog/a": html([], "Blog"), "/docs/b": html([], "Docs"),
        });
        const { body } = await runCrawl({ url: "https://site.test/", include: ["/blog"] });
        const urls = body.pages.map((p) => p.url);
        expect(urls).toContain("https://site.test/blog/a");
        expect(urls).not.toContain("https://site.test/docs/b");
    });

    it("truncates page content at maxChars", async () => {
        stubSite({ "/": `<html><body><p>${"x".repeat(5000)}</p></body></html>` });
        const { body } = await runCrawl({ url: "https://site.test/", maxChars: 500, maxDepth: 0 });
        expect(body.pages[0]?.content?.length).toBeLessThanOrEqual(500);
        expect(body.pages[0]).toMatchObject({ truncated: true });
    });

    it("rejects an SSRF-unsafe start URL before fetching", async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal("fetch", fetchSpy);
        const { status, body } = await runCrawl({ url: "http://169.254.169.254/latest/meta-data/" });
        expect(status).toBe(400);
        expect(body.code).toBe("INVALID_URL");
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("skips non-HTML resources instead of returning garbage markdown", async () => {
        vi.stubGlobal("fetch", vi.fn((input: string | URL) => {
            const url = new URL(typeof input === "string" ? input : input.href);
            if (url.pathname === "/robots.txt") { return Promise.resolve(new Response("", { status: 404 })); }
            if (url.pathname === "/doc.pdf") {
                return Promise.resolve(new Response("%PDF-1.4 binary", { status: 200, headers: { "Content-Type": "application/pdf" } }));
            }
            return Promise.resolve(new Response(html(["/doc.pdf"], "Home"), { status: 200, headers: { "Content-Type": "text/html" } }));
        }));
        const { body } = await runCrawl({ url: "https://site.test/" });
        const pdf = body.pages.find((p) => p.url.endsWith("/doc.pdf"));
        expect(pdf?.status).toBe("failed");
        expect(pdf?.error).toContain("Unsupported content type");
    });
});
