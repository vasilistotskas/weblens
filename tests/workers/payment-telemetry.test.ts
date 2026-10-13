/**
 * The payment wall writes one funnel event per paid-route request to the
 * PAYMENT_EVENTS Analytics Engine dataset, driven through the real Worker.
 */

import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PAYMENT_EVENT_BLOBS } from "../../src/services/payment-telemetry";

const ORIGIN = "https://api.weblens.dev";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("payment funnel events", () => {
    it("records exactly one 'unpaid' event for a 402 probe", async () => {
        const write = vi.spyOn(env.PAYMENT_EVENTS, "writeDataPoint");

        const res = await SELF.fetch(`${ORIGIN}/fetch/basic`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: "https://example.com" }),
        });

        expect(res.status).toBe(402);
        expect(write).toHaveBeenCalledTimes(1);
        const point = write.mock.calls[0]?.[0];
        expect(point?.indexes).toEqual(["/fetch/basic"]);
        const blobs = Object.fromEntries(PAYMENT_EVENT_BLOBS.map((k, i) => [k, point?.blobs?.[i]]));
        expect(blobs.outcome).toBe("unpaid");
        expect(blobs.requestId).toBeTruthy();
        // doubles: [amount quoted by the challenge, latency]
        expect(point?.doubles?.[0]).toBeGreaterThan(0);
    });
});
