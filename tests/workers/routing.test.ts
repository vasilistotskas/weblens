/**
 * Routing policies, driven through the real Worker.
 *
 * Both behaviours pinned here were measured funnel leaks, not hypotheticals.
 * Over one production week ~7k requests POSTed to GET-only routes and ~10.8k
 * asked for a documented path with the `{placeholder}` still in it; all of them
 * got a 404 that said the resource did not exist. A regression here is silent —
 * the caller simply goes away — so it gets tests rather than manual probing.
 */

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { PAID_ENDPOINTS, PARAMETERIZED_ROUTES } from "../../src/config";

const ORIGIN = "https://api.weblens.dev";

/** Paths registered for GET only, which agents were POSTing to. */
const GET_ONLY_PATHS = ["/", "/discovery", "/dashboard", "/mcp/info", "/credits/history"];

describe("method not allowed", () => {
    it.each(GET_ONLY_PATHS)("POST %s answers 405 with an Allow header, not 404", async (path) => {
        const res = await SELF.fetch(`${ORIGIN}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
        });

        expect(res.status).toBe(405);
        expect(res.headers.get("Allow")).toContain("GET");

        const body = await res.json() as Record<string, unknown>;
        expect(body.code).toBe("METHOD_NOT_ALLOWED");
        // The envelope contract: `error` always mirrors `code`.
        expect(body.error).toBe(body.code);
        expect(body.allowedMethods).toContain("GET");
        expect(body.requestId).toBeTruthy();
    });

    it("still answers GET on a POST-only paid endpoint with 405, ahead of the payment wall", async () => {
        // This path is guarded separately: the payment middleware is registered
        // with app.use() and matches every method, so without the POST-only
        // policy a GET here would be answered with a 402 challenge.
        const res = await SELF.fetch(`${ORIGIN}/research/deep`);

        expect(res.status).toBe(405);
        expect(res.headers.get("Allow")).toBe("POST");
        expect((await res.json() as Record<string, unknown>).allowedMethods).toEqual(["POST"]);
    });

    it("leaves a genuinely unknown path as 404", async () => {
        const res = await SELF.fetch(`${ORIGIN}/no/such/route`, { method: "POST" });

        expect(res.status).toBe(404);
        expect((await res.json() as Record<string, unknown>).code).toBe("NOT_FOUND");
    });

    it("does not divert a correctly-methoded paid request into a 405", async () => {
        // POST on a paid endpoint must still reach the payment wall.
        const res = await SELF.fetch(`${ORIGIN}/research/deep`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: "test" }),
        });

        expect(res.status).toBe(402);
    });
});

describe("unsubstituted path templates", () => {
    it.each(PARAMETERIZED_ROUTES.map((r) => [r.template, r] as const))(
        "%s answers 400 with a callable example",
        async (template, route) => {
            const res = await SELF.fetch(`${ORIGIN}${template}`);

            expect(res.status).toBe(400);

            const body = await res.json() as Record<string, unknown>;
            expect(body.code).toBe("UNSUBSTITUTED_PATH_TEMPLATE");
            expect(body.error).toBe(body.code);
            expect(body.template).toBe(template);
            expect(body.parameter).toBe(route.param);
            expect(body.example).toBe(`${ORIGIN}${route.example}`);
            // The example must not itself contain a placeholder.
            expect(body.example as string).not.toMatch(/[{}]/u);
        },
    );

    it("matches the percent-encoded form agents actually send", async () => {
        // Real traffic arrives as %7Burl%7D; Hono decodes it before routing.
        const res = await SELF.fetch(`${ORIGIN}/r/%7Burl%7D`);

        expect(res.status).toBe(400);
        expect((await res.json() as Record<string, unknown>).code).toBe("UNSUBSTITUTED_PATH_TEMPLATE");
    });

    it("does not intercept a real URL that happens to contain braces", async () => {
        const res = await SELF.fetch(`${ORIGIN}/r/https://example.com/a%7Bb%7D`);

        // Whatever the reader does with it, it must not be mistaken for an
        // unsubstituted template.
        expect((await res.json() as Record<string, unknown>).code)
            .not.toBe("UNSUBSTITUTED_PATH_TEMPLATE");
    });

    it("answers before the free-tier rate limiter charges quota", async () => {
        // Well past the 10/hour free-tier allowance; a malformed path must not
        // consume it, so none of these may come back 429.
        for (let i = 0; i < 12; i++) {
            const res = await SELF.fetch(`${ORIGIN}/s/%7Bquery%7D`);
            expect(res.status).toBe(400);
        }
    });
});

describe("route table coverage", () => {
    it("registers no paid endpoint that is also a parameterized template", () => {
        // A path cannot be both, and the two guards run in the opposite order.
        const templates = new Set(PARAMETERIZED_ROUTES.map((r) => r.template));
        expect(PAID_ENDPOINTS.filter((p) => templates.has(p))).toEqual([]);
    });
});
