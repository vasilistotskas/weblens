/**
 * /company's profile pipeline against a scripted site: which pages it finds,
 * that robots.txt is honoured page by page, that the AI's answer is validated
 * rather than trusted (sources must be pages it was actually given), and that
 * the failures a buyer must not be charged for surface as errors.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { PAID_UPSTREAMS } from "../../src/config";
import {
    classifyPages,
    declaredEmployees,
    employeeBand,
    parseAiProfile,
    ProfileExtractionError,
    profileCompany,
    RobotsDisallowedError,
    securityContacts,
    SiteUnreachableError,
} from "../../src/services/company-profile";
import type { AiPage } from "../../src/services/company-profile";
import type { Env } from "../../src/types";

const ORIGIN = "https://acme.com";
const env = {} as Env;

const html = (body: string) => new Response(`<html><head><title>Acme</title></head><body>${body}</body></html>`, { headers: { "content-type": "text/html" } });
const text = (body: string) => new Response(body, { headers: { "content-type": "text/plain" } });
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

const AI_ANSWER = {
    name: "Acme",
    description: "Acme sells rockets.",
    offerings: ["Rockets", 42, "Anvils"],
    audience: "Coyotes",
    pricingModel: "subscription",
    plans: [{ name: "Pro", price: "$20", period: "month" }, { price: "$1" }],
    industry: "31-33",
    employees: { count: 120, quote: "a team of 120 people" },
    sources: {
        name: `${ORIGIN}/`,
        pricing: `${ORIGIN}/pricing`,
        audience: "https://elsewhere.example/",
        industry: `${ORIGIN}/`,
        employees: `${ORIGIN}/about`,
    },
};

interface Site { robots?: string; homepage?: Response; links?: string; careersAt?: string }

/** Answer every request the pipeline makes; record what was asked for. */
function serve(site: Site = {}): string[] {
    const requested: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = input instanceof Request ? input.url : String(input);
        requested.push(url);
        const careers = site.careersAt ?? "/careers";
        const routes: Record<string, () => Response> = {
            [`${ORIGIN}/robots.txt`]: () => text(site.robots ?? "User-agent: *\nDisallow:"),
            [ORIGIN]: () => site.homepage ?? html(site.links ?? `<a href="/about">About</a><a href="/pricing">Pricing</a><a href="${careers}">Careers</a><a href="https://x.com/acme">X</a>`),
            [`${ORIGIN}/about`]: () => html("<p>About Acme: we are a team of\n120 people.</p>"),
            [`${ORIGIN}/pricing`]: () => html("<p>Pro $20/month</p>"),
            [`${ORIGIN}${careers}`]: () => html(`<a href="https://job-boards.greenhouse.io/acme/jobs/1">Engineer</a>`),
            "https://boards-api.greenhouse.io/v1/boards/acme/jobs": () => json({ jobs: [
                { title: "Engineer", location: { name: "Remote" }, absolute_url: "https://job-boards.greenhouse.io/acme/jobs/1" },
                { title: "Designer", location: { name: "Remote" } },
            ], meta: { total: 2 } }),
            [`${ORIGIN}/.well-known/security.txt`]: () => text("Contact: mailto:security@acme.com\nExpires: 2027-01-01T00:00:00Z"),
            [PAID_UPSTREAMS.anthropicMessages]: () => json({ content: [{ type: "text", text: JSON.stringify(AI_ANSWER) }] }),
        };
        const route = routes[url.replace(/\/$/u, "")] ?? routes[url];
        return Promise.resolve(route ? route() : new Response("not found", { status: 404 }));
    });
    return requested;
}

describe("profileCompany", () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it("builds the profile from the site's own pages, its job board and security.txt", async () => {
        serve();
        const profile = await profileCompany("acme.com", env, "key");

        expect(profile).toMatchObject({
            domain: "acme.com",
            name: "Acme",
            offerings: ["Rockets", "Anvils"],
            pricing: { pageUrl: `${ORIGIN}/pricing`, model: "subscription", plans: [{ name: "Pro", price: "$20", period: "month" }] },
            hiring: { provider: "greenhouse", openRoles: 2, boardUrl: "https://job-boards.greenhouse.io/acme" },
            pages: { about: `${ORIGIN}/about`, pricing: `${ORIGIN}/pricing`, careers: `${ORIGIN}/careers` },
            socials: { twitter: "https://x.com/acme" },
            securityContacts: ["mailto:security@acme.com"],
            skipped: [],
        });
        // A source naming a page the model was not given is dropped.
        // A trailing slash the page URL lacks still matches; it is reported as the page URL.
        expect(profile.sources).toEqual([
            { field: "name", url: ORIGIN },
            { field: "pricing", url: `${ORIGIN}/pricing` },
            { field: "industry", url: ORIGIN },
            { field: "employees", url: `${ORIGIN}/about` },
        ]);
        // The head count is the about page's own words; the sector is the model's classification.
        expect(profile.size).toEqual({
            band: "51-200",
            employees: { min: 120 },
            basis: "self-reported",
            evidence: "a team of 120 people",
            source: `${ORIGIN}/about`,
        });
        expect(profile.industry).toEqual({ naicsSector: "31-33", name: "Manufacturing", basis: "estimated", source: ORIGIN });
        expect(profile.coverage).toEqual({
            name: true, description: true, offerings: true, audience: true, pricing: true, hiring: true,
            size: true, industry: true, tech: false, socials: true, securityContacts: true,
        });
    });

    it("prefers the head count the site declares in schema.org JSON-LD", async () => {
        const jsonLd = `<script type="application/ld+json">${JSON.stringify({ "@graph": [{ "@type": "Organization", numberOfEmployees: { "@type": "QuantitativeValue", minValue: 500, maxValue: 1000 } }] })}</script>`;
        serve({ links: `${jsonLd}<a href="/about">About</a>` });
        const profile = await profileCompany("acme.com", env, "key");

        expect(profile.size).toEqual({
            band: "201-500",
            employees: { min: 500, max: 1000 },
            basis: "self-reported",
            evidence: "schema.org numberOfEmployees: 500-1000",
            source: ORIGIN,
        });
    });

    it("skips a page robots.txt disallows, and never fetches it", async () => {
        const requested = serve({ robots: "User-agent: *\nDisallow: /pricing" });
        const profile = await profileCompany("acme.com", env, "key");

        expect(profile.skipped).toEqual([{ url: `${ORIGIN}/pricing`, reason: "robots.txt" }]);
        expect(profile.pricing.pageUrl).toBeUndefined();
        expect(requested).not.toContain(`${ORIGIN}/pricing`);
    });

    it("tries the conventional careers path when the homepage links none", async () => {
        serve({ links: `<a href="/about">About</a>` });
        const profile = await profileCompany("acme.com", env, "key");

        expect(profile.pages.careers).toBe(`${ORIGIN}/careers`);
        expect(profile.hiring?.openRoles).toBe(2);
    });

    it("refuses a site whose robots.txt disallows the homepage", async () => {
        serve({ robots: "User-agent: *\nDisallow: /" });
        await expect(profileCompany("acme.com", env, "key")).rejects.toBeInstanceOf(RobotsDisallowedError);
    });

    it("fails when the homepage cannot be read, so the caller is not charged", async () => {
        serve({ homepage: new Response("down", { status: 503, headers: { "content-type": "text/html" } }) });
        await expect(profileCompany("acme.com", env, "key")).rejects.toBeInstanceOf(SiteUnreachableError);
    });
});

/** A page as the AI pass reads it. */
function page(url: string, body = ""): AiPage {
    return { url, title: "", description: "", text: body };
}

describe("company size", () => {
    it("reads schema.org numberOfEmployees as a number, a numeric string or a QuantitativeValue", () => {
        const ld = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
        expect(declaredEmployees(ld({ "@type": "Organization", numberOfEmployees: 42 }))).toEqual({ min: 42, max: 42 });
        expect(declaredEmployees(ld([{ "@type": "WebSite" }, { "@type": "Corporation", numberOfEmployees: "1,500" }]))).toEqual({ min: 1500, max: 1500 });
        expect(declaredEmployees(ld({ numberOfEmployees: { value: 80 } }))).toEqual({ min: 80, max: 80 });
        expect(declaredEmployees(ld({ numberOfEmployees: { minValue: 11, maxValue: 50 } }))).toEqual({ min: 11, max: 50 });
        expect(declaredEmployees(ld({ numberOfEmployees: { minValue: 5000 } }))).toEqual({ min: 5000 });
        expect(declaredEmployees(ld({ numberOfEmployees: "many" }))).toBeUndefined();
        expect(declaredEmployees(`<script type="application/ld+json">{not json</script>`)).toBeUndefined();
    });

    it("bands a head count by the band that holds it", () => {
        expect([1, 10, 11, 200, 201, 1000, 1001, 10_000, 10_001, 250_000].map(employeeBand))
            .toEqual(["1-10", "1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+", "10001+"]);
    });
});

describe("profile parsing", () => {
    it("keeps only typed values and sources among the given pages", () => {
        const profile = parseAiProfile(JSON.stringify({
            name: 7,
            offerings: "not a list",
            pricingModel: "barter",
            plans: "none",
            sources: { name: "https://a.example/", nonsense: "https://a.example/" },
        }), [page("https://a.example/")]);

        expect(profile).toEqual({
            name: undefined, description: undefined, offerings: [], audience: undefined, pricingModel: undefined, plans: [],
            industry: undefined, employees: undefined, sources: [{ field: "name", url: "https://a.example/" }],
        });
    });

    it("keeps a sector only from the NAICS list, and only with a source", () => {
        const parse = (industry: unknown, sources: Record<string, string>) =>
            parseAiProfile(JSON.stringify({ industry, sources }), [page("https://a.example/")]).industry;

        expect(parse("51", { industry: "https://a.example/" })).toBe("51");
        expect(parse("99", { industry: "https://a.example/" })).toBeUndefined();
        expect(parse("toString", { industry: "https://a.example/" })).toBeUndefined();
        expect(parse("51", {})).toBeUndefined();
    });

    it("keeps a head count only when the quote is on the cited page and states that number of people", () => {
        const about = page("https://a.example/about", "Founded in 2010. Today we are   over 1,200 employees across 9 countries.");
        const parse = (employees: unknown) =>
            parseAiProfile(JSON.stringify({ employees, sources: { employees: about.url } }), [about]).employees;

        expect(parse({ count: 1200, quote: "over 1,200 employees" })).toEqual({ count: 1200, quote: "over 1,200 employees" });
        // Not on the page: invented.
        expect(parse({ count: 5000, quote: "over 5,000 employees" })).toBeUndefined();
        // On the page, but the number is not the one quoted.
        expect(parse({ count: 1500, quote: "over 1,200 employees" })).toBeUndefined();
        // On the page, but not a head count.
        expect(parse({ count: 9, quote: "9 countries" })).toBeUndefined();
        expect(parse({ count: 2010, quote: "Founded in 2010" })).toBeUndefined();
    });

    it("rejects a reply that is not a JSON object", () => {
        expect(() => parseAiProfile("Here is the profile:", [])).toThrow(ProfileExtractionError);
        expect(() => parseAiProfile("[1,2]", [])).toThrow(ProfileExtractionError);
    });

    it("picks the shortest path per page role", () => {
        expect(classifyPages([`${ORIGIN}/en/pricing`, `${ORIGIN}/pricing`, `${ORIGIN}/company`, `${ORIGIN}/blog`])).toEqual({
            pricing: `${ORIGIN}/pricing`,
            about: `${ORIGIN}/company`,
        });
    });

    it("reads Contact lines from security.txt", () => {
        expect(securityContacts("# comment\nContact: mailto:security@acme.com\ncontact:https://acme.com/sec\nPolicy: x", "acme.com")).toEqual([
            "mailto:security@acme.com",
            "https://acme.com/sec",
        ]);
    });

    // Contact lines as published by real security.txt files (fetched 2026-10-20).
    it.each([
        ["vercel.com", "mailto:responsible.disclosure@vercel.com"],
        ["redhat.com", "mailto:secalert@redhat.com"],
        ["adobe.com", "mailto:psirt@adobe.com"],
        ["hp.com", "mailto:hp-security-alert@hp.com"],
        ["zoom.us", "mailto:security-reports@zoom.us"],
        ["debian.org", "mailto:team@security.debian.org"],
        ["ibm.com", "mailto:psirt@us.ibm.com"],
        ["github.com", "https://hackerone.com/github"],
        ["amazon.com", "https://hackerone.com/amazonvrp/reports/new"],
        ["adobe.com", "https://app.intigriti.com/programs/adobe/adobepublic/detail"],
        ["apple.com", "https://security.apple.com/"],
        ["redhat.com", "https://access.redhat.com/security/team/contact/"],
    ])("keeps the company-level contact of %s: %s", (domain, contact) => {
        expect(securityContacts(`Contact: ${contact}`, domain)).toEqual([contact]);
    });

    it("writes a bare address (no mailto:) as a mailto: URI", () => {
        expect(securityContacts("Contact: security@npmjs.com", "npmjs.com")).toEqual(["mailto:security@npmjs.com"]);
    });

    it("drops anything that can name a person, and phone numbers", () => {
        const text = [
            "Contact: mailto:jane.doe@acme.com",
            "Contact: mailto:jdoe@acme.com",
            "Contact: mailto:security.jane@acme.com",
            "Contact: mailto:jane%2Bsecurity@acme.com",
            "Contact: tel:+1-201-555-0123",
            // securitytxt.org lists its author's HackerOne profile.
            "Contact: https://hackerone.com/ed",
            "Contact: http://acme.com/security",
            "Contact: ftp://acme.com/security",
        ].join("\n");
        expect(securityContacts(text, "acme.com")).toEqual([]);
        expect(securityContacts("Contact: https://hackerone.com/ed", "securitytxt.org")).toEqual([]);
    });

    it("decodes a percent-encoded mailbox before judging it", () => {
        expect(securityContacts("Contact: mailto:security%2Breports@acme.com", "acme.com")).toEqual(["mailto:security%2Breports@acme.com"]);
    });

    it("keeps at most five contacts, counted after filtering", () => {
        const text = ["jane@acme.com", ...["security", "abuse", "psirt", "cert", "noc", "soc"].map((box) => `${box}@acme.com`)]
            .map((address) => `Contact: mailto:${address}`).join("\n");
        expect(securityContacts(text, "acme.com")).toEqual(["security", "abuse", "psirt", "cert", "noc"].map((box) => `mailto:${box}@acme.com`));
    });
});
