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
    parseAiProfile,
    ProfileExtractionError,
    profileCompany,
    RobotsDisallowedError,
    securityContacts,
    SiteUnreachableError,
} from "../../src/services/company-profile";
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
    sources: { name: `${ORIGIN}/`, pricing: `${ORIGIN}/pricing`, audience: "https://elsewhere.example/" },
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
            [`${ORIGIN}/about`]: () => html("<p>About Acme</p>"),
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
        expect(profile.sources).toEqual([{ field: "name", url: ORIGIN }, { field: "pricing", url: `${ORIGIN}/pricing` }]);
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

describe("profile parsing", () => {
    it("keeps only typed values and sources among the given pages", () => {
        const profile = parseAiProfile(JSON.stringify({
            name: 7,
            offerings: "not a list",
            pricingModel: "barter",
            plans: "none",
            sources: { name: "https://a.example/", nonsense: "https://a.example/" },
        }), ["https://a.example/"]);

        expect(profile).toEqual({ name: undefined, description: undefined, offerings: [], audience: undefined, pricingModel: undefined, plans: [], sources: [{ field: "name", url: "https://a.example/" }] });
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
