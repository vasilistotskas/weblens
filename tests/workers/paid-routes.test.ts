/**
 * Every paid route is generated from its registry definition, so the 402
 * challenge a buyer actually receives must match that definition: the price
 * it resolves to, the networks it may be paid on, and the input it advertises
 * to Bazaar catalogs. Driven through the real Worker, one request per route.
 */

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "../../src/endpoints";
import { endpointBodySchema } from "../../src/endpoints/define";
import type { EndpointDefinition } from "../../src/endpoints/define";
import { parsePrice } from "../../src/services/pricing";

interface Challenge {
    accepts: { network: string; amount: string }[];
    extensions?: {
        bazaar?: {
            info?: { input?: { body?: unknown } };
            schema?: { properties?: { input?: { properties?: { body?: unknown } } } };
        };
    };
}

const DEFINITIONS: readonly EndpointDefinition[] = ENDPOINTS;

/** USDC has 6 decimals on every network WebLens accepts. */
const toAtomicUsdc = (price: string): string => String(Math.round(parsePrice(price) * 1e6));

async function challengeFor(endpoint: EndpointDefinition): Promise<Challenge> {
    const res = await SELF.fetch(`https://api.weblens.dev${endpoint.path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(endpoint.inputExample),
    });
    expect(res.status, `${endpoint.path} should answer its own example with a 402`).toBe(402);
    const header = res.headers.get("PAYMENT-REQUIRED");
    expect(header, `${endpoint.path} must carry a PAYMENT-REQUIRED header`).toBeTruthy();
    return JSON.parse(new TextDecoder().decode(
        Uint8Array.from(atob(header ?? ""), (ch) => ch.charCodeAt(0)),
    )) as Challenge;
}

describe("generated paid routes", () => {
    it.each(DEFINITIONS.map((e) => [e.path, e] as const))("%s: the 402 matches its definition", async (_path, endpoint) => {
        const challenge = await challengeFor(endpoint);

        const expected = toAtomicUsdc(endpoint.price.resolve(endpoint.input.parse(endpoint.inputExample)));
        expect(challenge.accepts.length).toBeGreaterThan(0);
        for (const accept of challenge.accepts) {
            expect(accept.amount, accept.network).toBe(expected);
        }

        if (endpoint.evmOnly) {
            expect(challenge.accepts.every((a) => a.network.startsWith("eip155:"))).toBe(true);
        }

        const bazaar = challenge.extensions?.bazaar;
        expect(bazaar?.info?.input?.body).toEqual(endpoint.inputExample);
        expect(bazaar?.schema?.properties?.input?.properties?.body).toEqual(endpointBodySchema(endpoint));
    });
});
