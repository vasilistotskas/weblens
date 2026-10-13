/**
 * The endpoint registry is the single source for every paid route and every
 * advertised price and schema, so its definitions must be internally
 * consistent: examples that validate, prices whose range contains every price
 * they can resolve to, and descriptions catalogs will accept.
 */

import { describe, expect, it } from "vitest";
import { PRICING } from "../../src/config";
import { ENDPOINTS, productPriceRange } from "../../src/endpoints";
import { describePrice, requestBodySchema, x402Charge, x402PriceBounds } from "../../src/endpoints/define";
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

/**
 * PayAI's documented settle fee for a Base EIP-3009 payment (2.31 credits at
 * $0.001 each, docs.payai.network/x402/facilitators/pricing): the dearest fee
 * any configured facilitator charges per x402 sale.
 */
const WORST_SETTLE_FEE = 0.00231;

describe("x402 price floor", () => {
    const floor = parsePrice(PRICING.x402Minimum);

    it("covers the dearest facilitator settle fee", () => {
        expect(floor).toBeGreaterThan(WORST_SETTLE_FEE);
    });

    it("raises a cheaper price to the floor and leaves the rest alone", () => {
        expect(x402Charge("$0.0006")).toBe(PRICING.x402Minimum);
        expect(x402Charge(PRICING.x402Minimum)).toBe(PRICING.x402Minimum);
        expect(x402Charge("$0.0060")).toBe("$0.0060");
    });

    it.each(DEFINITIONS.map((e) => [e.path, e] as const))("%s: every x402 charge lies inside the advertised x402 range", (_path, endpoint) => {
        const bounds = x402PriceBounds(endpoint);
        expect(bounds.min).toBeGreaterThanOrEqual(floor);
        const example = endpoint.input.parse(endpoint.inputExample);
        for (const resolved of [endpoint.price.resolve(undefined), endpoint.price.resolve(example)]) {
            const charge = parsePrice(x402Charge(resolved));
            expect(charge).toBeGreaterThanOrEqual(bounds.min);
            expect(charge).toBeLessThanOrEqual(bounds.max + 1e-9);
        }
    });

    it("tells buyers about the floor only where it applies", () => {
        const floorNote = `an x402 payment is at least ${PRICING.x402Minimum}`;
        const byPath = (path: string) => DEFINITIONS.find((e) => e.path === path);
        const contents = byPath("/contents");
        const search = byPath("/search");
        expect(contents && describePrice(contents)).toContain(floorNote);
        expect(search && describePrice(search)).not.toContain(floorNote);
    });

    it("advertises a catalog range that starts at the floor", () => {
        expect(productPriceRange().startsWith(`$${floor.toFixed(4)} - `)).toBe(true);
    });
});
