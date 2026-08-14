/**
 * Every `{param}` path we publish must carry a callable example.
 *
 * The leak this guards against is self-inflicted: agents read the discovery
 * catalogue and the ERC-8004 registration document, copy `endpoint` verbatim,
 * and call `/r/{url}` braces and all — ~10.8k times a week in production. The
 * fix only holds if a newly published template cannot escape the table that
 * `pathTemplateMiddleware` answers from, so this walks the real runtime values
 * rather than trusting the source to stay in sync.
 */

import { describe, expect, it } from "vitest";
import { PARAMETERIZED_ROUTES, pathExample } from "../../src/config";
import { buildRegistration } from "../../src/services/erc8004";
import { SERVICE_CATALOG } from "../../src/tools/discovery";

/** A whitespace-delimited token carrying an unsubstituted placeholder. */
const TEMPLATE_TOKEN = /\S*\{[a-zA-Z][a-zA-Z0-9]*\}\S*/gu;

/**
 * Reduce a published token to the path the router would see. The catalogue
 * publishes bare paths; the registration document publishes absolute URLs, and
 * WHATWG `URL` percent-encodes the braces in `pathname` — the very encoding
 * real callers send — so it has to be decoded back.
 */
function toRoutePath(token: string): string | null {
    try {
        return decodeURIComponent(new URL(token).pathname);
    } catch {
        const start = token.indexOf("/");
        return start === -1 ? null : token.slice(start);
    }
}

/** Every template-looking path reachable anywhere in a published document. */
function templatePathsIn(value: unknown, found = new Set<string>()): Set<string> {
    if (typeof value === "string") {
        for (const match of value.matchAll(TEMPLATE_TOKEN)) {
            const path = toRoutePath(match[0]);
            if (path !== null) { found.add(path); }
        }
        return found;
    }
    if (Array.isArray(value)) {
        for (const item of value) { templatePathsIn(item, found); }
        return found;
    }
    if (value !== null && typeof value === "object") {
        for (const item of Object.values(value)) { templatePathsIn(item, found); }
    }
    return found;
}

const REGISTERED = new Set(PARAMETERIZED_ROUTES.map((route) => route.template));

describe("published path templates", () => {
    it("registers every template the discovery catalogue publishes", () => {
        const published = [...templatePathsIn(SERVICE_CATALOG)];
        const unregistered = published.filter((path) => !REGISTERED.has(path));

        expect(unregistered, `unregistered in PARAMETERIZED_ROUTES: ${unregistered.join(", ")}`).toEqual([]);
        // Guard the guard: if the walker stops finding anything, it has broken.
        expect(published.length).toBeGreaterThan(0);
    });

    it("registers every template the ERC-8004 registration document publishes", () => {
        const published = [...templatePathsIn(buildRegistration("https://api.weblens.dev"))];
        const unregistered = published.filter((path) => !REGISTERED.has(path));

        expect(unregistered, `unregistered in PARAMETERIZED_ROUTES: ${unregistered.join(", ")}`).toEqual([]);
        expect(published.length).toBeGreaterThan(0);
    });

    it("gives every registered template a substituted, callable example", () => {
        for (const route of PARAMETERIZED_ROUTES) {
            expect(route.example, `${route.template} example`).not.toMatch(/[{}]/u);
            expect(route.example.startsWith("/"), `${route.template} example is a path`).toBe(true);
            expect(route.methods.length).toBeGreaterThan(0);
            expect(route.template).toContain(`{${route.param}}`);
        }
    });

    it("exposes each example through pathExample and rejects unknown templates", () => {
        for (const route of PARAMETERIZED_ROUTES) {
            expect(pathExample(route.template)).toBe(route.example);
        }
        expect(() => pathExample("/not/a/{template}")).toThrow(/No example registered/u);
    });
});
