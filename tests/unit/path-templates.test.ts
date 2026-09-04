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
import {
    PARAMETERIZED_ROUTES,
    absolutePathPublication,
    pathExample,
    pathPublication,
} from "../../src/config";
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
        const published = [...templatePathsIn(buildRegistration("https://api.weblens.dev", {}))];
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

/**
 * A key that names a location a consumer will fetch. `uriTemplate` is
 * deliberately excluded: it is the one field whose name announces that the
 * value must be expanded before use.
 */
function isDereferenceableKey(key: string): boolean {
    const name = key.toLowerCase();
    if (name === "uritemplate") { return false; }
    return /(endpoint|url|uri|href|link)$/u.test(name);
}

/** Every [keyPath, value] pair sitting under a dereferenceable key. */
function dereferenceableStrings(
    value: unknown,
    path = "",
    found: [string, string][] = []
): [string, string][] {
    if (Array.isArray(value)) {
        value.forEach((item, i) => dereferenceableStrings(item, `${path}[${i}]`, found));
        return found;
    }
    if (value !== null && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
            const child = path ? `${path}.${key}` : key;
            if (typeof item === "string" && isDereferenceableKey(key)) {
                found.push([child, item]);
            }
            dereferenceableStrings(item, child, found);
        }
    }
    return found;
}

describe("dereferenceable fields are always fetchable", () => {
    // The regression this pins: `endpoint: "/r/{url}"` in the catalogue sent
    // ~44k requests a week to the literal brace string, because agents fetch
    // whatever sits in a field that looks like a URL. A template may only be
    // published under a key that says it is a template.
    const documents: [string, unknown][] = [
        ["discovery catalogue", SERVICE_CATALOG],
        ["ERC-8004 registration", buildRegistration("https://api.weblens.dev", {})],
    ];

    for (const [name, document] of documents) {
        it(`publishes no unsubstituted template in a URL-ish field of the ${name}`, () => {
            const offenders = dereferenceableStrings(document)
                .filter(([, value]) => /\{[a-zA-Z][a-zA-Z0-9]*\}/u.test(value))
                .map(([key, value]) => `${key} = ${value}`);

            expect(offenders, `dereferenceable fields holding a template: ${offenders.join(", ")}`)
                .toEqual([]);
        });
    }

    it("still finds fields to check, so the walker cannot silently pass", () => {
        expect(dereferenceableStrings(SERVICE_CATALOG).length).toBeGreaterThan(0);
        expect(dereferenceableStrings(buildRegistration("https://x", {})).length).toBeGreaterThan(0);
    });

    it("publishes a callable endpoint exactly for caller-supplied parameters", () => {
        for (const route of PARAMETERIZED_ROUTES) {
            const published = pathPublication(route.template);
            expect(published.uriTemplate).toBe(route.template);
            if (route.callableExample) {
                // Caller supplies the value, so the example is a live call.
                expect(published.endpoint).toBe(route.example);
            } else {
                // The id is one we issue; any example would 404 for a reader,
                // so nothing fetchable may be published for it.
                expect(published.endpoint, `${route.template} must publish no endpoint`)
                    .toBeUndefined();
            }
        }
    });

    it("resolves an absolute publication against an origin", () => {
        const published = absolutePathPublication("https://api.weblens.dev", "/r/{url}");
        expect(published.endpoint).toBe("https://api.weblens.dev/r/https://example.com");
        expect(published.uriTemplate).toBe("https://api.weblens.dev/r/{url}");
        expect(() => absolutePathPublication("https://x", "/nope/{id}")).toThrow(/No entry/u);
    });
});
