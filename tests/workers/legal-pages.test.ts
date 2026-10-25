/**
 * The legal pages, driven through the real Worker.
 *
 * Stripe's website requirements and the Managed Payments terms ask for terms,
 * a refund policy and a privacy policy that name the seller, give a contact
 * and link Link's customer terms; the EU e-commerce rules ask for a
 * geographic address. A page that loses one of those is a silent compliance
 * gap, so they are pinned here.
 */

import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { LEGAL, OPERATOR } from "../../src/config";

const ORIGIN = "https://api.weblens.dev";

async function get(path: string, accept = "text/html"): Promise<Response> {
    return exports.default.fetch(`${ORIGIN}${path}`, { headers: { Accept: accept } });
}

describe("legal pages", () => {
    it("names a geographic address for the operator", () => {
        expect(OPERATOR.address.trim()).not.toBe("");
    });

    it.each(Object.values(LEGAL.paths))("%s is an indexable page naming the operator and a contact", async (path) => {
        const res = await get(path);
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toContain("text/html");
        expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");

        const body = await res.text();
        expect(body).not.toContain("noindex");
        expect(body).toContain(OPERATOR.email);
        expect(body).toContain(LEGAL.updated);
        for (const link of Object.values(LEGAL.paths)) {
            expect(body).toContain(`href="${link}"`);
        }
    });

    it("the terms name the operator's address and link Link's customer terms", async () => {
        const body = await (await get(LEGAL.paths.terms)).text();
        expect(body).toContain(OPERATOR.name);
        expect(body).toContain(OPERATOR.address);
        expect(body).toContain(LEGAL.linkTerms);
    });

    it("the refund policy states Link's refund window and links its refund page", async () => {
        const body = await (await get(LEGAL.paths.refunds)).text();
        expect(body).toContain(`${String(LEGAL.refundWindowDays)} days`);
        expect(body).toContain(LEGAL.linkRefunds);
    });

    it("the landing page and the OpenAPI document link the terms", async () => {
        const landing = await (await get("/")).text();
        for (const link of Object.values(LEGAL.paths)) {
            expect(landing).toContain(`href="${link}"`);
        }

        const spec = await (await get("/openapi.json", "application/json")).json<{ info: { termsOfService?: string; contact?: { email?: string } } }>();
        expect(spec.info.termsOfService).toBe(`${ORIGIN}${LEGAL.paths.terms}`);
        expect(spec.info.contact?.email).toBe(OPERATOR.email);
    });

    it("lists the legal pages in the sitemap", async () => {
        const sitemap = await (await get("/sitemap.xml", "application/xml")).text();
        for (const link of Object.values(LEGAL.paths)) {
            expect(sitemap).toContain(`<loc>${ORIGIN}${link}</loc>`);
        }
    });
});
