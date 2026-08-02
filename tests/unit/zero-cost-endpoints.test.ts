/**
 * The zero-upstream-cost intelligence endpoints: /package, /tech, /discussions.
 *
 * Each one's value is a judgement layered on free public data, so the
 * judgement is what is pinned: which health signals fire for a package, which
 * technologies a set of headers and markup betray, and whether the discussion
 * aggregates describe the returned set honestly.
 *
 * `normalizePackageName` is security-relevant — its output is interpolated
 * into registry URLs — so its rejections are asserted too.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSignals, normalizePackageName, type PackageReport } from "../../src/services/package-intel";
import { fingerprint } from "../../src/services/tech-detect";
import { searchDiscussions } from "../../src/services/discussions";

// ============================================
// /package
// ============================================

const HEALTHY: Omit<PackageReport, "signals"> = {
    name: "express",
    registry: "npm",
    found: true,
    version: "5.2.1",
    license: "MIT",
    repository: "https://github.com/expressjs/express",
    deprecated: false,
    maintenance: { daysSinceRelease: 30, maintainers: 5 },
};

describe("normalizePackageName", () => {
    it("accepts plain and scoped npm names", () => {
        expect(normalizePackageName("express", "npm")).toBe("express");
        expect(normalizePackageName("@scope/pkg", "npm")).toBe("@scope/pkg");
        expect(normalizePackageName("  Express  ", "npm")).toBe("express");
    });

    it("accepts PyPI names, which keep their case", () => {
        expect(normalizePackageName("requests", "pypi")).toBe("requests");
        expect(normalizePackageName("Flask-SQLAlchemy", "pypi")).toBe("Flask-SQLAlchemy");
    });

    it("rejects names that could escape the registry URL", () => {
        for (const bad of [
            "", "   ", "../etc/passwd", "a/b/c", "pkg?x=1", "pkg#frag",
            "http://evil.com", "pkg name", "@scope", "@/pkg", "-lead",
        ]) {
            expect(normalizePackageName(bad, "npm"), `npm should reject ${JSON.stringify(bad)}`).toBeNull();
        }
    });

    it("rejects an over-long name", () => {
        expect(normalizePackageName("a".repeat(215), "npm")).toBeNull();
    });
});

describe("package health signals", () => {
    it("reports nothing for a healthy package", () => {
        expect(buildSignals(HEALTHY)).toEqual([]);
    });

    it("flags a deprecated package", () => {
        expect(buildSignals({ ...HEALTHY, deprecated: true })).toContain("deprecated");
    });

    it("flags a package with no release in over two years", () => {
        expect(buildSignals({ ...HEALTHY, maintenance: { ...HEALTHY.maintenance, daysSinceRelease: 900 } }))
            .toContain("no-recent-release");
        expect(buildSignals({ ...HEALTHY, maintenance: { ...HEALTHY.maintenance, daysSinceRelease: 700 } }))
            .not.toContain("no-recent-release");
    });

    it("flags missing license, bus-factor-of-one, and no public repo", () => {
        expect(buildSignals({ ...HEALTHY, license: undefined })).toContain("no-license");
        expect(buildSignals({ ...HEALTHY, license: "" })).toContain("no-license");
        expect(buildSignals({ ...HEALTHY, maintenance: { maintainers: 1 } })).toContain("single-maintainer");
        expect(buildSignals({ ...HEALTHY, repository: undefined })).toContain("no-public-repository");
    });

    it("does not invent a release-age signal when the date is unknown", () => {
        expect(buildSignals({ ...HEALTHY, maintenance: { maintainers: 5 } }))
            .not.toContain("no-recent-release");
    });
});

// ============================================
// /tech
// ============================================

describe("technology fingerprinting", () => {
    it("identifies stack from response headers", () => {
        const { categories } = fingerprint(
            ["Server: Vercel", "X-Powered-By: Next.js, Payload", "x-vercel-id: iad1::abc"],
            "",
        );
        expect(categories.framework).toContain("Next.js");
        expect(categories.hosting).toContain("Vercel");
    });

    it("identifies stack from HTML markers", () => {
        const { categories } = fingerprint([], `
            <script src="/_next/static/chunks/main.js"></script>
            <script src="https://www.googletagmanager.com/gtm.js"></script>
            <script src="https://js.stripe.com/v3"></script>
        `);
        expect(categories.framework).toContain("Next.js");
        expect(categories.analytics).toContain("Google Tag Manager");
        expect(categories.payments).toContain("Stripe");
    });

    it("reads the platform out of a meta generator tag", () => {
        const { generator, technologies } = fingerprint([], '<meta name="generator" content="WordPress 6.5.2">');
        expect(generator).toBe("wordpress 6.5.2");
        expect(technologies.some((t) => t.name.toLowerCase().startsWith("wordpress"))).toBe(true);
    });

    it("is case-insensitive across headers and markup", () => {
        const { categories } = fingerprint(["SERVER: CLOUDFLARE", "CF-RAY: abc"], "<DIV CLASS='WP-CONTENT'></DIV>");
        expect(categories.cdn).toContain("Cloudflare");
    });

    it("attaches evidence to every detection", () => {
        const { technologies } = fingerprint(["cf-ray: abc123"], '<script src="https://cdn.shopify.com/x.js">');
        expect(technologies.length).toBeGreaterThan(0);
        for (const tech of technologies) {
            expect(tech.evidence, `${tech.name} has no evidence`).toBeTruthy();
        }
        expect(technologies.find((t) => t.name === "Shopify")?.evidence).toContain("cdn.shopify.com");
    });

    it("detects nothing rather than guessing on a bare page", () => {
        const { technologies } = fingerprint([], "<html><body>hello</body></html>");
        expect(technologies).toEqual([]);
    });

    it("reports each technology once even when several rules match it", () => {
        // Next.js has both a header rule and two HTML rules.
        const { technologies } = fingerprint(
            ["x-powered-by: Next.js"],
            '<div id="__NEXT_DATA__"></div><script src="/_next/static/a.js">',
        );
        expect(technologies.filter((t) => t.name === "Next.js")).toHaveLength(1);
    });
});

// ============================================
// /discussions
// ============================================

const HN_RESPONSE = {
    nbHits: 1259,
    hits: [
        { objectID: "1", title: "Workerd released", url: "https://github.com/cloudflare/workerd", points: 689, num_comments: 133, author: "jgrahamc", created_at: "2022-09-27T14:00:00.000Z" },
        { objectID: "2", title: "Workers AI", url: "https://blog.cloudflare.com/workers-ai", points: 300, num_comments: 50, author: "x", created_at: "2024-01-01T00:00:00.000Z" },
        { objectID: "3", title: "Another repo", url: "https://github.com/foo/bar", points: 11, num_comments: 2, author: "y", created_at: "2020-05-05T00:00:00.000Z" },
    ],
};

function mockHn(body: unknown, ok = true) {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
        ok, status: ok ? 200 : 503, json: () => Promise.resolve(body),
    })));
}

describe("Hacker News discussions", () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it("maps hits to stories with a link to the thread", async () => {
        mockHn(HN_RESPONSE);
        const report = await searchDiscussions("cloudflare workers", 10, "relevance");

        expect(report.stories).toHaveLength(3);
        expect(report.stories[0]).toMatchObject({
            title: "Workerd released", points: 689, comments: 133, author: "jgrahamc",
            discussionUrl: "https://news.ycombinator.com/item?id=1",
        });
    });

    it("separates total matches from what was returned", async () => {
        mockHn(HN_RESPONSE);
        const { summary } = await searchDiscussions("q", 10, "relevance");

        // Conflating these would overstate reach: 1259 stories matched, 3 came back.
        expect(summary.totalMatches).toBe(1259);
        expect(summary.returned).toBe(3);
        expect(summary.pointsReturned).toBe(1000);
        expect(summary.commentsReturned).toBe(185);
    });

    it("ranks the most-submitted domains", async () => {
        mockHn(HN_RESPONSE);
        const { summary } = await searchDiscussions("q", 10, "relevance");
        expect(summary.topDomains[0]).toEqual({ domain: "github.com", count: 2 });
    });

    it("reports the discussion window oldest-first", async () => {
        mockHn(HN_RESPONSE);
        const { summary } = await searchDiscussions("q", 10, "relevance");
        expect(summary.firstSeen).toBe("2020-05-05T00:00:00.000Z");
        expect(summary.lastSeen).toBe("2024-01-01T00:00:00.000Z");
    });

    it("uses the by-date index when recency is requested", async () => {
        mockHn(HN_RESPONSE);
        await searchDiscussions("q", 5, "recent");
        const url = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
        expect(url).toContain("search_by_date");
        expect(url).toContain("hitsPerPage=5");
    });

    it("survives a hit with null fields rather than emitting nulls", async () => {
        mockHn({ nbHits: 1, hits: [{ objectID: "9", title: null, url: null, points: null, num_comments: null, created_at: null }] });
        const { stories } = await searchDiscussions("q", 10, "relevance");
        expect(stories[0]).toMatchObject({ title: "(untitled)", points: 0, comments: 0 });
        expect(stories[0]?.url).toBeUndefined();
    });

    it("raises rather than returning an empty result when HN fails", async () => {
        mockHn({}, false);
        await expect(searchDiscussions("q", 10, "relevance")).rejects.toThrow(/503/u);
    });
});
