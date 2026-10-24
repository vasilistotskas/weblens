/**
 * x402scan discovery-contract tests for /openapi.json.
 *
 * x402scan (x402scan.com/discovery/spec) requires: info.x-guidance, per-paid-op
 * x-payment-info (fixed or dynamic price mode with currency) alongside a 402
 * response, `security: []` on free/auth-gated ops so probes skip them, and a
 * request example so registration probes can pass validation and reach the
 * 402 challenge. These tests pin that contract so a doc regression can't
 * silently break registration again.
 */

import { describe, expect, it } from "vitest";
import { getOpenAPIDocument } from "../../src/openapi";

interface Operation {
    security?: unknown[];
    responses?: Record<string, unknown>;
    requestBody?: {
        content?: Record<string, { example?: unknown; schema?: unknown }>;
    };
    "x-payment-info"?: {
        price: { mode: string; currency: string; amount?: string; min?: string; max?: string };
        protocols: { x402: object }[];
    };
}

const HTTP_METHODS = ["get", "post", "put", "delete", "patch"] as const;

function allOperations(): [string, Operation][] {
    const doc = getOpenAPIDocument({ NETWORK: "base" }) as unknown as { paths: Record<string, Record<string, Operation>> };
    const ops: [string, Operation][] = [];
    for (const [path, methods] of Object.entries(doc.paths)) {
        for (const method of HTTP_METHODS) {
            if (methods[method]) {
                ops.push([`${method.toUpperCase()} ${path}`, methods[method]]);
            }
        }
    }
    return ops;
}

const USD_AMOUNT = /^\d+\.\d{6}$/u;

describe("openapi.json x402scan discovery contract", () => {
    const doc = getOpenAPIDocument({ NETWORK: "base" }) as unknown as {
        openapi: string;
        info: Record<string, unknown>;
        paths: Record<string, unknown>;
    };

    it("has the required top-level fields", () => {
        expect(doc.openapi).toBe("3.1.0");
        expect(doc.info.title).toBeTruthy();
        expect(doc.info.version).toBeTruthy();
        expect(typeof doc.info["x-guidance"]).toBe("string");
        expect((doc.info["x-guidance"] as string).length).toBeGreaterThan(50);
        expect(Object.keys(doc.paths).length).toBeGreaterThan(0);
    });

    it("classifies every operation as paid (x-payment-info + 402) or free (security: [])", () => {
        for (const [name, op] of allOperations()) {
            const paid = op["x-payment-info"] !== undefined;
            const free = Array.isArray(op.security) && op.security.length === 0;
            expect(paid || free, `${name} is unclassified — probes would fail`).toBe(true);
            if (paid) {
                expect(op.responses?.["402"], `${name} declares x-payment-info without a 402 response`).toBeDefined();
            }
        }
    });

    it("declares a valid price mode on every paid operation", () => {
        for (const [name, op] of allOperations()) {
            const info = op["x-payment-info"];
            if (!info) { continue; }
            expect(info.protocols.some((p) => "x402" in p), `${name} missing x402 protocol`).toBe(true);
            expect(info.price.currency).toBe("USD");
            if (info.price.mode === "fixed") {
                expect(info.price.amount, `${name} fixed amount`).toMatch(USD_AMOUNT);
            } else {
                expect(info.price.mode).toBe("dynamic");
                expect(info.price.min, `${name} dynamic min`).toMatch(USD_AMOUNT);
                expect(info.price.max, `${name} dynamic max`).toMatch(USD_AMOUNT);
                expect(Number(info.price.min)).toBeLessThan(Number(info.price.max));
            }
        }
    });

    it("gives every paid operation a request example so probes reach the 402", () => {
        for (const [name, op] of allOperations()) {
            if (!op["x-payment-info"] || !op.requestBody) { continue; }
            const media = op.requestBody.content?.["application/json"];
            expect(media?.example, `${name} has no request example`).toBeDefined();
        }
    });

    // x402scan's registration prober builds a minimal body from the schema's
    // REQUIRED properties (property-level example > format > bare "test").
    // A required string without example/format samples as "test", which fails
    // our Zod URL validation with 400 — so the prober never sees the 402 and
    // the endpoint is skipped from the marketplace.
    it("makes every required property of a paid op probe-sampleable", () => {
        const components = (getOpenAPIDocument({ NETWORK: "base" }) as unknown as {
            components: { schemas: Record<string, SchemaObject> };
        }).components.schemas;

        for (const [name, op] of allOperations()) {
            if (!op["x-payment-info"] || !op.requestBody) { continue; }
            let schema = op.requestBody.content?.["application/json"]?.schema as SchemaObject | undefined;
            const ref = (schema as { $ref?: string } | undefined)?.$ref;
            if (ref) { schema = components[ref.slice(ref.lastIndexOf("/") + 1)]; }
            expect(schema, `${name} has no request schema`).toBeDefined();

            const required: string[] = (schema as { required?: string[] }).required ?? [];
            const props = (schema as { properties?: Record<string, SchemaObject> }).properties ?? {};
            for (const key of required) {
                const prop = props[key] as {
                    type?: string; example?: unknown; format?: string;
                    enum?: unknown[]; const?: unknown; default?: unknown; minItems?: number;
                };
                expect(prop, `${name}.${key} is required but undeclared`).toBeDefined();
                const hasLiteral = prop.example !== undefined || prop.const !== undefined
                    || prop.default !== undefined || (prop.enum?.length ?? 0) > 0;
                if (prop.type === "object" || prop.type === "array") {
                    expect(hasLiteral, `${name}.${key}: required ${prop.type} needs an example`).toBe(true);
                    if (prop.type === "array" && prop.minItems && Array.isArray(prop.example)) {
                        expect(prop.example.length).toBeGreaterThanOrEqual(prop.minItems);
                    }
                } else if (prop.type === "string" && /url/iu.test(key)) {
                    expect(hasLiteral || prop.format === "uri" || prop.format === "url",
                        `${name}.${key}: URL field samples as "test" without example/format`).toBe(true);
                }
            }
        }
    });
});

type SchemaObject = Record<string, unknown>;

describe("prepaid API keys in the discovery document", () => {
    interface Doc {
        info: { description: string; "x-guidance": string };
        paths: Record<string, Record<string, Operation>>;
        components: { securitySchemes: Record<string, unknown> };
        security: unknown[];
    }
    const cardsOn = getOpenAPIDocument({ NETWORK: "base", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x" }) as unknown as Doc;
    const cardsOff = getOpenAPIDocument({ NETWORK: "base" }) as unknown as Doc;

    it("lists nothing about keys where card sales are off", () => {
        expect(Object.keys(cardsOff.paths).filter((path) => path.startsWith("/billing") || path.startsWith("/account"))).toEqual([]);
        expect(cardsOff.components.securitySchemes).not.toHaveProperty("bearerAuth");
        expect(cardsOff.security).toEqual([{ x402Payment: [] }]);
        expect(cardsOff.info["x-guidance"]).not.toContain("Bearer");
    });

    it("offers a key as an alternative to x402 where card sales are on", () => {
        expect(cardsOn.components.securitySchemes).toHaveProperty("bearerAuth", expect.objectContaining({ type: "http", scheme: "bearer" }));
        expect(cardsOn.security).toEqual([{ x402Payment: [] }, { bearerAuth: [] }]);
        expect(cardsOn.info["x-guidance"]).toContain("Authorization: Bearer");
        expect(cardsOn.paths["/billing/checkout"]?.post?.security).toEqual([]);
        expect(cardsOn.paths["/account"]?.get?.security).toEqual([{ bearerAuth: [] }]);
        expect(cardsOn.paths["/account/key/rotate"]?.post?.security).toEqual([{ bearerAuth: [] }]);
    });

    it("keeps every paid operation x402scan-payable with card sales on", () => {
        const paidOff = Object.entries(cardsOff.paths).filter(([, methods]) => methods.post?.["x-payment-info"]);
        const paidOn = Object.entries(cardsOn.paths).filter(([, methods]) => methods.post?.["x-payment-info"]);
        expect(paidOn.map(([path]) => path)).toEqual(paidOff.map(([path]) => path));
        for (const [path, methods] of paidOn) {
            expect(methods.post?.responses, path).toHaveProperty("402");
            // x402scan classifies by x-payment-info; an operation-level security list would override the document's.
            expect(methods.post?.security, path).toBeUndefined();
        }
    });
});
