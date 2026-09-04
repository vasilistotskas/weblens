/**
 * A `tools/call` that needs paying must hand the caller a *signable* challenge.
 *
 * x402 v2 carries the challenge in the base64 `PAYMENT-REQUIRED` **response
 * header** and leaves the 402 body as `{}`. The MCP bridge read the body, so
 * every paid tool call came back as "Payment Required" with `data: {}` — no
 * amount, no asset, no payTo, nothing an agent could sign. That is invisible
 * from the outside until a buyer actually tries to pay, so the shape is pinned
 * here rather than left to manual probing.
 */

import { describe, expect, it } from "vitest";
import { paymentRequiredError } from "../../src/tools/mcp";

/** The real shape api.weblens.dev returns, trimmed to the fields a payer needs. */
const CHALLENGE = {
    x402Version: 2,
    error: "Payment required",
    resource: { url: "https://api.weblens.dev/fetch/basic" },
    accepts: [
        {
            scheme: "exact",
            network: "eip155:8453",
            amount: "2000",
            asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            payTo: "0x1369f9899B0Eb899336A196003c86262997e7567",
            maxTimeoutSeconds: 300,
            extra: { name: "USD Coin", version: "2" },
        },
    ],
};

const encoded = btoa(JSON.stringify(CHALLENGE));

/** A 402 exactly as the x402 middleware emits it: empty body, challenge in the header. */
function response402(headers: Record<string, string> = {}): Response {
    return new Response("{}", { status: 402, headers });
}

const TOOL = { endpoint: "/fetch/basic", price: "$0.002" };

describe("MCP payment-required error", () => {
    it("decodes the PAYMENT-REQUIRED header into a signable challenge", () => {
        const err = paymentRequiredError(response402({ "PAYMENT-REQUIRED": encoded }), TOOL);

        expect(err.code).toBe(402);
        const challenge = err.data.paymentRequired as typeof CHALLENGE;
        expect(challenge.accepts[0]).toMatchObject({
            scheme: "exact",
            network: "eip155:8453",
            amount: "2000",
            asset: CHALLENGE.accepts[0].asset,
            payTo: CHALLENGE.accepts[0].payTo,
        });
    });

    it("passes the raw header through for x402 client libraries", () => {
        const err = paymentRequiredError(response402({ "PAYMENT-REQUIRED": encoded }), TOOL);
        expect(err.data.paymentRequiredHeader).toBe(encoded);
    });

    it("never hands back an empty payment payload — the bug this replaced", () => {
        const err = paymentRequiredError(response402({ "PAYMENT-REQUIRED": encoded }), TOOL);

        // The old implementation returned `await response.json()`, i.e. `{}`.
        expect(err.data).not.toEqual({});
        expect(err.data.paymentRequired).toBeDefined();
    });

    it("names the price and endpoint even when the header is absent", () => {
        const err = paymentRequiredError(response402(), TOOL);

        expect(err.message).toContain("$0.002");
        expect(err.message).toContain("/fetch/basic");
        expect(err.data.endpoint).toBe("/fetch/basic");
        expect(err.data.price).toBe("$0.002");
        expect(err.data.paymentRequired).toBeUndefined();
        expect(err.data.paymentRequiredHeader).toBeUndefined();
    });

    it("degrades instead of throwing on a corrupt header", () => {
        const err = paymentRequiredError(response402({ "PAYMENT-REQUIRED": "!!not base64!!" }), TOOL);

        expect(err.code).toBe(402);
        expect(err.data.paymentRequired).toBeUndefined();
        // Still forwarded verbatim — a client may decode it more leniently.
        expect(err.data.paymentRequiredHeader).toBe("!!not base64!!");
    });

    it("tells the caller both ways to pay", () => {
        const howToPay = String(paymentRequiredError(response402(), TOOL).data.howToPay);

        expect(howToPay).toContain("Payment-Signature");
        expect(howToPay).toContain("X-CREDIT-WALLET");
    });
});
