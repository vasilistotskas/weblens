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

type Operation = {
    security?: unknown[];
    responses?: Record<string, unknown>;
    requestBody?: {
        content?: Record<string, { example?: unknown }>;
    };
    "x-payment-info"?: {
        price: { mode: string; currency: string; amount?: string; min?: string; max?: string };
        protocols: { x402: object }[];
    };
};

const HTTP_METHODS = ["get", "post", "put", "delete", "patch"] as const;

function allOperations(): [string, Operation][] {
    const doc = getOpenAPIDocument() as unknown as { paths: Record<string, Record<string, Operation>> };
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
    const doc = getOpenAPIDocument() as unknown as {
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
});
