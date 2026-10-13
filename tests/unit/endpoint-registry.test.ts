/**
 * The endpoint registry is the single source for every paid route and every
 * advertised price and schema, so its definitions must be internally
 * consistent: examples that validate, prices whose range contains every price
 * they can resolve to, and descriptions catalogs will accept.
 */

import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "../../src/endpoints";
import { requestBodySchema } from "../../src/endpoints/define";
import type { EndpointDefinition } from "../../src/endpoints/define";
import { parsePrice } from "../../src/services/pricing";

const DEFINITIONS: readonly EndpointDefinition[] = ENDPOINTS;

/** CDP's Bazaar guidance caps resource descriptions at 500 characters. */
const MAX_DESCRIPTION = 500;

describe("endpoint registry", () => {
    it("defines each path and each title once", () => {
        const paths = DEFINITIONS.map((e) => e.path);
        const titles = DEFINITIONS.map((e) => e.title);
        expect(new Set(paths).size).toBe(paths.length);
        expect(new Set(titles).size).toBe(titles.length);
        for (const path of paths) { expect(path.startsWith("/"), path).toBe(true); }
    });

    it.each(DEFINITIONS.map((e) => [e.path, e] as const))("%s: input example validates", (_path, endpoint) => {
        const parsed = endpoint.input.safeParse(endpoint.inputExample);
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    });

    it.each(DEFINITIONS.map((e) => [e.path, e] as const))("%s: description fits catalog limits", (_path, endpoint) => {
        expect(endpoint.description.trim()).not.toBe("");
        expect(endpoint.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION);
    });

    it.each(DEFINITIONS.map((e) => [e.path, e] as const))("%s: every resolvable price lies inside the advertised range", (_path, endpoint) => {
        const { price } = endpoint;
        expect(price.min).toBeGreaterThan(0);
        expect(price.max).toBeGreaterThanOrEqual(price.min);

        const example = endpoint.input.parse(endpoint.inputExample);
        for (const resolved of [price.resolve(undefined), price.resolve(example)]) {
            expect(resolved).toMatch(/^\$\d+(\.\d+)?$/u);
            expect(parsePrice(resolved)).toBeGreaterThanOrEqual(price.min);
            expect(parsePrice(resolved)).toBeLessThanOrEqual(price.max + 1e-9);
        }
    });

    it.each(DEFINITIONS.map((e) => [e.path, e] as const))("%s: advertises an embeddable object schema for its body", (_path, endpoint) => {
        const schema = requestBodySchema(endpoint.input);
        expect(schema.$schema).toBeUndefined();
        expect(schema.type).toBe("object");
        expect(typeof schema.properties).toBe("object");
    });

    it.each(DEFINITIONS.map((e) => [e.path, e] as const))("%s: output example only uses declared fields", (_path, endpoint) => {
        const declared = Object.keys(endpoint.outputSchema.properties);
        const undeclared = Object.keys(endpoint.outputExample).filter((key) => !declared.includes(key));
        expect(undeclared).toEqual([]);
    });
});
