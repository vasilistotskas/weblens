/**
 * PayAI authentication and facilitator selection.
 *
 * PayAI rejects a bad credential instead of downgrading to anonymous access
 * (docs.payai.network/x402/facilitators/authentication), and it is the
 * primary facilitator: a malformed token, or a key attached when only half of
 * it is configured, would fail every payment. /health reads the same
 * selection, so it reports the facilitators that actually settle, with the
 * primary one as critical.
 */

import { Buffer } from "node:buffer";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { facilitatorEntries } from "../../src/middleware/payment";
import { payaiAuthHeaders } from "../../src/services/payai-auth";
import { health } from "../../src/tools/health";
import type { AppEnv, Env, HealthResponse } from "../../src/types";

const KEY_ID = "00000000-0000-4000-8000-000000000001";

/** A fresh Ed25519 key in PayAI's secret format: `payai_sk_` + base64 PKCS#8. */
async function payaiKey(): Promise<{ secret: string; publicKey: CryptoKey }> {
    const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
    return { secret: `payai_sk_${Buffer.from(pkcs8).toString("base64")}`, publicKey: pair.publicKey };
}

const decodePart = (part: string): Record<string, unknown> =>
    JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

function bearer(headers: Record<string, string> | undefined): string {
    const auth = headers?.Authorization ?? "";
    expect(auth.startsWith("Bearer ")).toBe(true);
    return auth.slice("Bearer ".length);
}

async function signatureValid(token: string, publicKey: CryptoKey): Promise<boolean> {
    const [header = "", payload = "", signature = ""] = token.split(".");
    return crypto.subtle.verify("Ed25519", publicKey, Buffer.from(signature, "base64url"), new TextEncoder().encode(`${header}.${payload}`));
}

const envWith = (fields: Partial<Env>): Env => fields as Env;

describe("payaiAuthHeaders", () => {
    it("signs the documented EdDSA JWT", async () => {
        const { secret, publicKey } = await payaiKey();
        const headers = await payaiAuthHeaders(KEY_ID, secret, () => 1000)();
        const token = bearer(headers.verify);
        const [header = "", payload = ""] = token.split(".");

        expect(token).not.toContain("=");
        expect(decodePart(header)).toEqual({ alg: "EdDSA", typ: "JWT", kid: KEY_ID });
        const claims = decodePart(payload);
        expect(Object.keys(claims).sort()).toEqual(["exp", "iat", "iss", "jti", "sub"]);
        expect(claims).toMatchObject({ sub: KEY_ID, iss: "payai-merchant", iat: 1000, exp: 1120 });
        expect(claims.jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
        expect(await signatureValid(token, publicKey)).toBe(true);
    });

    it("authenticates verify and settle with the same token, and leaves /supported public", async () => {
        const { secret } = await payaiKey();
        const headers = await payaiAuthHeaders(KEY_ID, secret, () => 1000)();

        expect(Object.keys(headers).sort()).toEqual(["settle", "verify"]);
        expect(bearer(headers.settle)).toBe(bearer(headers.verify));
    });

    it("reuses a token until 30 seconds before it expires, then signs a new one", async () => {
        const { secret } = await payaiKey();
        let now = 1000;
        const next = payaiAuthHeaders(KEY_ID, secret, () => now);
        const first = bearer((await next()).verify);

        now = 1089;
        expect(bearer((await next()).verify)).toBe(first);

        now = 1090;
        const renewed = bearer((await next()).verify);
        expect(renewed).not.toBe(first);
        expect(decodePart(renewed.split(".")[1] ?? "")).toMatchObject({ iat: 1090, exp: 1210 });
    });

    it("accepts the secret without its prefix and with surrounding whitespace", async () => {
        const { secret, publicKey } = await payaiKey();
        const bare = `  ${secret.slice("payai_sk_".length)}\n`;
        const token = bearer((await payaiAuthHeaders(KEY_ID, bare, () => 1000)()).verify);

        expect(await signatureValid(token, publicKey)).toBe(true);
    });
});

describe("facilitatorEntries", () => {
    const cdpKeys = { CDP_API_KEY_ID: "cdp-id", CDP_API_KEY_SECRET: "cdp-secret" };

    it("puts PayAI first and CDP second when CDP keys are set", () => {
        expect(facilitatorEntries(envWith(cdpKeys)).map((e) => e.label)).toEqual(["payai", "cdp"]);
    });

    it("puts CDP first only for a bootstrap request", () => {
        expect(facilitatorEntries(envWith(cdpKeys), true).map((e) => e.label)).toEqual(["cdp", "payai"]);
    });

    it("uses PayAI alone without CDP keys, and x402.org alone on testnet", () => {
        expect(facilitatorEntries(envWith({})).map((e) => e.label)).toEqual(["payai"]);
        expect(facilitatorEntries(envWith({ ...cdpKeys, NETWORK: "base-sepolia" })).map((e) => e.label)).toEqual(["x402.org"]);
    });

    it("authenticates PayAI verify and settle with the API key", async () => {
        const { secret, publicKey } = await payaiKey();
        const [payai] = facilitatorEntries(envWith({ PAYAI_API_KEY_ID: KEY_ID, PAYAI_API_KEY_SECRET: secret }));

        for (const path of ["verify", "settle"]) {
            const token = bearer((await payai.client.createAuthHeaders(path)).headers);
            expect(await signatureValid(token, publicKey)).toBe(true);
        }
        expect((await payai.client.createAuthHeaders("supported")).headers).toEqual({});
    });

    it("sends no credential when only half of the key is configured", async () => {
        const { secret } = await payaiKey();
        for (const env of [{ PAYAI_API_KEY_ID: KEY_ID }, { PAYAI_API_KEY_SECRET: secret }]) {
            const [payai] = facilitatorEntries(envWith(env));
            expect((await payai.client.createAuthHeaders("verify")).headers).toEqual({});
        }
    });
});

describe("/health facilitators", () => {
    afterEach(() => { vi.restoreAllMocks(); });

    const production = envWith({
        CDP_API_KEY_ID: "cdp-id",
        CDP_API_KEY_SECRET: "cdp-secret",
        CACHE: { get: () => Promise.resolve(null) } as unknown as KVNamespace,
        BROWSER: {} as Fetcher,
    });

    /** Answer facilitator probes, failing the hosts listed in `down`. */
    function facilitatorsReachable(down: string[] = []): void {
        vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
            const host = new URL(input instanceof Request ? input.url : String(input)).host;
            return down.includes(host) ? Promise.reject(new Error("connect ECONNREFUSED")) : Promise.resolve(new Response("{}"));
        });
    }

    async function check(env: Env): Promise<{ status: number; body: HealthResponse }> {
        const app = new Hono<AppEnv>().get("/health", health);
        const res = await app.request("/health", {}, env);
        return { status: res.status, body: await res.json() };
    }

    it("reports the facilitators that settle, in precedence order", async () => {
        facilitatorsReachable();
        const { status, body } = await check(production);

        expect(status).toBe(200);
        expect(body.status).toBe("healthy");
        expect(Object.keys(body.services.facilitators)).toEqual(["payai", "cdp"]);
    });

    it("is degraded, not down, when only the fallback facilitator is unreachable", async () => {
        facilitatorsReachable(["api.cdp.coinbase.com"]);
        const { status, body } = await check(production);

        expect(status).toBe(200);
        expect(body.status).toBe("degraded");
        expect(body.services.facilitators.cdp?.status).toBe("unhealthy");
    });

    it("is down when the primary facilitator is unreachable", async () => {
        facilitatorsReachable(["facilitator.payai.network"]);
        const { status, body } = await check(production);

        expect(status).toBe(503);
        expect(body.status).toBe("unhealthy");
    });

    it("probes only the testnet facilitator on testnet", async () => {
        facilitatorsReachable();
        const { body } = await check(envWith({ ...production, NETWORK: "base-sepolia" }));

        expect(Object.keys(body.services.facilitators)).toEqual(["x402.org"]);
    });
});
