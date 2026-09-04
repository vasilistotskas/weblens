/**
 * The payment wall and the discovery surfaces must name the same networks.
 *
 * These can drift apart in either direction and both directions cost money:
 *
 * - Advertising a network the wall cannot settle sends buyers into a challenge
 *   that always fails. It is also how the wall itself breaks — registering a
 *   network the facilitator does not advertise on /supported leaves
 *   `initialize()` with no supported kind, and `buildPaymentRequirements` then
 *   throws for every request on the route.
 * - Advertising fewer networks than the wall accepts hides a way to pay.
 *
 * Driven through the real Worker so the assertion is made against the actual
 * 402 challenge rather than a reconstruction of it.
 */

import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { supportedNetworks } from "../../src/config";

interface Accept {
    scheme: string;
    network: string;
    amount?: string;
    payTo?: string;
    asset?: string;
}

/** Fetch a real 402 and decode the base64 PAYMENT-REQUIRED challenge. */
async function challenge(path: string): Promise<{ accepts: Accept[] }> {
    const res = await SELF.fetch(`https://api.weblens.dev${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
    });

    expect(res.status, `${path} should hit the payment wall`).toBe(402);

    const header = res.headers.get("PAYMENT-REQUIRED");
    expect(header, `${path} must carry a PAYMENT-REQUIRED header`).toBeTruthy();

    const json = new TextDecoder().decode(
        Uint8Array.from(atob(header ?? ""), (ch) => ch.charCodeAt(0))
    );
    return JSON.parse(json) as { accepts: Accept[] };
}

describe("advertised payment networks", () => {
    it("offers one accepts entry per advertised network, and no others", async () => {
        const { accepts } = await challenge("/fetch/basic");
        const advertised = supportedNetworks(env);

        expect(accepts.length).toBeGreaterThan(0);
        expect(accepts.map((a) => a.network).sort()).toEqual([...advertised].sort());
    });

    it("gives every entry everything a payer needs", async () => {
        const { accepts } = await challenge("/fetch/basic");

        for (const accept of accepts) {
            expect(accept.scheme, accept.network).toBe("exact");
            expect(accept.amount, accept.network).toBeTruthy();
            expect(accept.payTo, accept.network).toBeTruthy();
            expect(accept.asset, accept.network).toBeTruthy();
        }
    });

    it("keeps the same network set across routes", async () => {
        // A per-route divergence would mean one endpoint quietly dropped a
        // network, which is invisible until a buyer on that chain shows up.
        const basic = await challenge("/fetch/basic");
        const search = await challenge("/search");

        expect(search.accepts.map((a) => a.network).sort())
            .toEqual(basic.accepts.map((a) => a.network).sort());
    });

    it("advertises Solana only when a Solana payout address is configured", async () => {
        const { accepts } = await challenge("/fetch/basic");
        const solana = accepts.filter((a) => a.network.startsWith("solana:"));

        if (env.PAY_TO_ADDRESS_SVM?.trim()) {
            expect(solana).toHaveLength(1);
            expect(solana[0].payTo).toBe(env.PAY_TO_ADDRESS_SVM);
        } else {
            expect(solana).toHaveLength(0);
        }
    });
});
