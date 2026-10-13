/**
 * Job-board detection and parsing for /company's hiring signal. The link
 * shapes come from real careers pages (2026-10-13), and the payload shapes from
 * each provider's live API: a regex that drifts silently drops a company's
 * whole hiring section.
 */

import { describe, expect, it } from "vitest";
import { findJobBoard, parseRoles, summariseHiring } from "../../src/services/job-boards";

describe("findJobBoard", () => {
    it("reads the board from the link shapes real careers pages use", () => {
        // Vercel embeds its board as escaped JSON deep in a Next.js page.
        expect(findJobBoard(String.raw`[{\"absolute_url\":\"https://job-boards.greenhouse.io/vercel/jobs/6136160004\"`))
            .toEqual({ provider: "greenhouse", token: "vercel", eu: false });
        expect(findJobBoard(`<a href="https://boards.greenhouse.io/figma/jobs/6220093004?gh_jid=6220093004">`))
            .toEqual({ provider: "greenhouse", token: "figma", eu: false });
        expect(findJobBoard(`<a href="https://jobs.lever.co/palantir/61eaa54c-e1b7-4064-afad-f7df3d48d652">`))
            .toEqual({ provider: "lever", token: "palantir", eu: false });
        expect(findJobBoard(`<a href="https://jobs.ashbyhq.com/Linear/fb4b6076-b943-4d95-bb9b-a66aef8275f2">`))
            .toEqual({ provider: "ashby", token: "Linear", eu: false });
    });

    it("takes the board an embed names in for=, and Lever's EU host", () => {
        expect(findJobBoard(`<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>`))
            .toEqual({ provider: "greenhouse", token: "acme", eu: false });
        expect(findJobBoard(`<a href="https://jobs.eu.lever.co/acme-eu/123">`))
            .toEqual({ provider: "lever", token: "acme-eu", eu: true });
    });

    it("finds nothing on a page without a supported board", () => {
        expect(findJobBoard(`<a href="/careers/apply">Apply</a> <a href="https://workday.example/jobs">`)).toBeUndefined();
    });
});

describe("parseRoles", () => {
    it("reads Greenhouse's jobs list", () => {
        const roles = parseRoles("greenhouse", {
            jobs: [{ title: "Engineer", location: { name: "Remote" }, absolute_url: "https://job-boards.greenhouse.io/acme/jobs/1" }],
            meta: { total: 1 },
        });
        expect(roles).toEqual([{ title: "Engineer", location: "Remote", url: "https://job-boards.greenhouse.io/acme/jobs/1" }]);
    });

    it("reads Lever's posting array, team falling back to department", () => {
        const roles = parseRoles("lever", [
            { text: "Designer", categories: { location: "London", team: "Design" }, hostedUrl: "https://jobs.lever.co/acme/1" },
            { text: "Analyst", categories: { location: "NYC", department: "Finance" } },
        ]);
        expect(roles.map((r) => [r.title, r.team])).toEqual([["Designer", "Design"], ["Analyst", "Finance"]]);
    });

    it("leaves out Ashby roles that are not listed on the board", () => {
        const roles = parseRoles("ashby", { jobs: [
            { title: "PM", department: "Product", location: "Europe", isListed: true, jobUrl: "https://jobs.ashbyhq.com/acme/1" },
            { title: "Hidden", isListed: false },
        ] });
        expect(roles.map((r) => r.title)).toEqual(["PM"]);
    });

    it("yields no roles for an unexpected payload", () => {
        expect(parseRoles("greenhouse", "not json")).toEqual([]);
        expect(parseRoles("lever", { jobs: [] })).toEqual([]);
    });
});

describe("summariseHiring", () => {
    it("counts roles, ranks teams and locations, and samples the first few", () => {
        const hiring = summariseHiring({ provider: "lever", token: "acme", eu: false }, [
            { title: "A", team: "Eng", location: "Remote" },
            { title: "B", team: "Eng", location: "London" },
            { title: "C", team: "Sales", location: "Remote" },
            { title: "", team: "Ghost" },
        ], 2);
        expect(hiring).toMatchObject({
            provider: "lever",
            boardUrl: "https://jobs.lever.co/acme",
            openRoles: 3,
            topTeams: [{ name: "Eng", roles: 2 }, { name: "Sales", roles: 1 }],
            topLocations: [{ name: "Remote", roles: 2 }, { name: "London", roles: 1 }],
        });
        expect(hiring.sample.map((r) => r.title)).toEqual(["A", "B"]);
    });
});
