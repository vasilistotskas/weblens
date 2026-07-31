/**
 * Crawler primitives: robots.txt parsing/precedence, sitemap parsing, link
 * extraction, URL normalization, and path filters.
 *
 * These are the safety-critical parts of /map and /crawl — link and sitemap
 * data comes from the crawled site itself, so anything that escapes the
 * same-host or SSRF filters here becomes a server-side request forgery.
 *
 * Fixture shapes were validated against live robots.txt/sitemaps from
 * developers.cloudflare.com and x402.org (both serve nested sitemap indexes).
 */

import { describe, expect, it } from "vitest";
import {
    EMPTY_ROBOTS,
    extractLinks,
    isAllowedByRobots,
    isSameHost,
    matchesPathFilters,
    normalizeUrl,
    parseRobots,
    parseSitemap,
} from "../../src/services/crawler";

describe("normalizeUrl", () => {
    it("drops fragments and trailing slashes, lowercases host", () => {
        expect(normalizeUrl("https://Example.COM/a/#section")).toBe("https://example.com/a");
        expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
        expect(normalizeUrl("https://example.com")).toBe("https://example.com/");
    });

    it("preserves the query string (distinct pages)", () => {
        expect(normalizeUrl("https://example.com/search?q=1")).toBe("https://example.com/search?q=1");
    });

    it("resolves relative URLs against a base", () => {
        expect(normalizeUrl("/about", "https://example.com/blog/post")).toBe("https://example.com/about");
        expect(normalizeUrl("../x", "https://example.com/a/b/c")).toBe("https://example.com/a/x");
    });

    it("rejects non-http(s) schemes and garbage", () => {
        expect(normalizeUrl("mailto:a@b.com")).toBeNull();
        expect(normalizeUrl("javascript:alert(1)")).toBeNull();
        expect(normalizeUrl("tel:+123")).toBeNull();
        expect(normalizeUrl("data:text/html,x")).toBeNull();
        expect(normalizeUrl("not a url")).toBeNull();
    });
});

describe("isSameHost", () => {
    it("matches only the exact host", () => {
        expect(isSameHost("https://example.com/a", "https://example.com")).toBe(true);
        expect(isSameHost("https://EXAMPLE.com/a", "https://example.com")).toBe(true);
        expect(isSameHost("https://evil.com/a", "https://example.com")).toBe(false);
        // Subdomains and suffix tricks are different hosts.
        expect(isSameHost("https://sub.example.com/a", "https://example.com")).toBe(false);
        expect(isSameHost("https://example.com.evil.com/a", "https://example.com")).toBe(false);
    });
});

describe("matchesPathFilters", () => {
    it("excludes take precedence over includes", () => {
        expect(matchesPathFilters("https://e.com/blog/x", ["/blog"], ["/blog/x"])).toBe(false);
    });

    it("include acts as an allowlist when present", () => {
        expect(matchesPathFilters("https://e.com/blog/x", ["/blog"], [])).toBe(true);
        expect(matchesPathFilters("https://e.com/docs/x", ["/blog"], [])).toBe(false);
    });

    it("allows everything when no filters are given", () => {
        expect(matchesPathFilters("https://e.com/anything", [], [])).toBe(true);
    });

    it("matches against the query string too", () => {
        expect(matchesPathFilters("https://e.com/p?tag=news", [], ["tag=news"])).toBe(false);
    });
});

describe("parseRobots", () => {
    it("collects wildcard-group rules and global sitemaps", () => {
        const rules = parseRobots(`
# comment
User-agent: *
Disallow: /admin
Allow: /admin/public
Sitemap: https://example.com/sitemap.xml
        `);
        expect(rules.disallow).toContain("/admin");
        expect(rules.allow).toContain("/admin/public");
        expect(rules.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
    });

    it("ignores rules belonging to other user-agents", () => {
        const rules = parseRobots(`
User-agent: BadBot
Disallow: /

User-agent: *
Disallow: /private
        `);
        expect(rules.disallow).toEqual(["/private"]);
    });

    it("honours consecutive user-agent lines sharing one group", () => {
        const rules = parseRobots(`
User-agent: Googlebot
User-agent: *
Disallow: /shared
        `);
        expect(rules.disallow).toEqual(["/shared"]);
    });

    it("collects sitemaps declared outside any group", () => {
        const rules = parseRobots("Sitemap: https://x402.org/wp-sitemap.xml\nUser-agent: *\nDisallow:");
        expect(rules.sitemaps).toEqual(["https://x402.org/wp-sitemap.xml"]);
        // An empty Disallow means "allow everything" — not a rule.
        expect(rules.disallow).toEqual([]);
    });

    it("strips inline comments", () => {
        const rules = parseRobots("User-agent: *\nDisallow: /a # trailing note");
        expect(rules.disallow).toEqual(["/a"]);
    });
});

describe("isAllowedByRobots", () => {
    const rules = parseRobots(`
User-agent: *
Disallow: /admin
Allow: /admin/public
Disallow: /*.pdf$
    `);

    it("blocks disallowed prefixes", () => {
        expect(isAllowedByRobots("https://e.com/admin", rules)).toBe(false);
        expect(isAllowedByRobots("https://e.com/admin/secret", rules)).toBe(false);
    });

    it("longest match wins — Allow overrides a shorter Disallow", () => {
        expect(isAllowedByRobots("https://e.com/admin/public/doc", rules)).toBe(true);
    });

    it("allows unmatched paths", () => {
        expect(isAllowedByRobots("https://e.com/blog", rules)).toBe(true);
    });

    it("supports the * wildcard and $ anchor", () => {
        expect(isAllowedByRobots("https://e.com/files/report.pdf", rules)).toBe(false);
        expect(isAllowedByRobots("https://e.com/files/report.pdf?x=1", rules)).toBe(true);
    });

    it("allows everything when robots.txt is absent", () => {
        expect(isAllowedByRobots("https://e.com/anything", EMPTY_ROBOTS)).toBe(true);
    });

    it("treats a bare Disallow: / as a full block", () => {
        const blockAll = parseRobots("User-agent: *\nDisallow: /");
        expect(isAllowedByRobots("https://e.com/", blockAll)).toBe(false);
        expect(isAllowedByRobots("https://e.com/any/page", blockAll)).toBe(false);
    });
});

describe("extractLinks", () => {
    const base = "https://example.com/start";

    it("extracts and normalizes same-host links across quote styles", () => {
        const html = `
            <a href="/a">A</a>
            <a href='/b?x=1'>B</a>
            <a href=/c>C</a>
            <a  class="x"  href="https://example.com/d#frag" >D</a>
        `;
        expect(extractLinks(html, base)).toEqual([
            "https://example.com/a",
            "https://example.com/b?x=1",
            "https://example.com/c",
            "https://example.com/d",
        ]);
    });

    it("drops cross-host links", () => {
        const html = '<a href="https://evil.com/x">x</a><a href="/ok">ok</a>';
        expect(extractLinks(html, base)).toEqual(["https://example.com/ok"]);
    });

    it("drops non-http schemes", () => {
        const html = '<a href="mailto:a@b.com">m</a><a href="javascript:alert(1)">j</a><a href="tel:+1">t</a>';
        expect(extractLinks(html, base)).toEqual([]);
    });

    it("dedupes links that normalize to the same URL", () => {
        const html = '<a href="/a">1</a><a href="/a/">2</a><a href="/a#top">3</a>';
        expect(extractLinks(html, base)).toEqual(["https://example.com/a"]);
    });

    it("does not match non-anchor tags that contain href-like text", () => {
        const html = '<link href="/style.css"><a href="/real">r</a>';
        expect(extractLinks(html, base)).toEqual(["https://example.com/real"]);
    });

    it("blocks SSRF targets even when same-host resolution would pass", () => {
        // A page served from an internal host must not yield internal links.
        const internal = extractLinks('<a href="http://169.254.169.254/latest/meta-data/">m</a>', "http://169.254.169.254/");
        expect(internal).toEqual([]);
    });
});

describe("parseSitemap", () => {
    it("parses a urlset into page URLs", () => {
        const xml = `<?xml version="1.0"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://example.com/a</loc></url>
          <url><loc>https://example.com/b</loc></url>
        </urlset>`;
        expect(parseSitemap(xml)).toEqual({
            urls: ["https://example.com/a", "https://example.com/b"],
            sitemaps: [],
        });
    });

    it("parses a sitemapindex into nested sitemaps (the real-world shape)", () => {
        const xml = `<?xml version="1.0"?>
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <sitemap><loc>https://x402.org/wp-sitemap-posts-post-1.xml</loc></sitemap>
          <sitemap><loc>https://x402.org/wp-sitemap-posts-page-1.xml</loc></sitemap>
        </sitemapindex>`;
        const parsed = parseSitemap(xml);
        expect(parsed.urls).toEqual([]);
        expect(parsed.sitemaps).toHaveLength(2);
    });

    it("decodes XML entities in locations", () => {
        const xml = "<urlset><url><loc>https://example.com/a?x=1&amp;y=2</loc></url></urlset>";
        expect(parseSitemap(xml).urls).toEqual(["https://example.com/a?x=1&y=2"]);
    });

    it("drops SSRF-unsafe and malformed locations", () => {
        const xml = `<urlset>
          <url><loc>http://127.0.0.1/secret</loc></url>
          <url><loc>http://169.254.169.254/latest</loc></url>
          <url><loc>not-a-url</loc></url>
          <url><loc>https://example.com/ok</loc></url>
        </urlset>`;
        expect(parseSitemap(xml).urls).toEqual(["https://example.com/ok"]);
    });

    it("returns nothing for an empty document", () => {
        expect(parseSitemap("<urlset></urlset>")).toEqual({ urls: [], sitemaps: [] });
    });
});
