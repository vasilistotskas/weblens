/**
 * Calls a marketplace partner makes for its own users, through the real Worker:
 * served without x402 or a debit, recorded as a `partner` payment event, and
 * refused outright when the partner secret is wrong.
 */
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PARTNERS, PRICING } from "../../src/config";
import { PAYMENT_EVENT_BLOBS } from "../../src/services/payment-telemetry";
import { usdToMicros } from "../../src/services/pricing";

const ORIGIN = "https://api.weblens.dev";
const PAGE = "<html><head><title>Example</title></head><body><p>Example page</p></body></html>";
const HEADER = PARTNERS.apify.header;

function fetchBasic(headers: Record<string, string>, body: unknown = { url: "https://example.com/", cache: false }) {
    return exports.default.fetch(`${ORIGIN}/fetch/basic`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
    });
}

beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        Promise.resolve(new Response(PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe("partner calls", () => {
    it("serves the call without an x402 challenge and records it as a partner event at list price", async () => {
        const write = vi.spyOn(env.PAYMENT_EVENTS, "writeDataPoint");
        const res = await fetchBasic({ [HEADER]: "test-partner-secret" });

        expect(res.status).toBe(200);
        expect(res.headers.get("PAYMENT-REQUIRED")).toBeNull();
        expect(res.headers.get("Payment-Method")).toBe("Partner");
        expect(write).toHaveBeenCalledOnce();
        const point = write.mock.calls[0]?.[0];
        const blob = (key: (typeof PAYMENT_EVENT_BLOBS)[number]) => point?.blobs?.[PAYMENT_EVENT_BLOBS.indexOf(key)];
        expect(point?.indexes).toEqual(["/fetch/basic"]);
        expect(blob("outcome")).toBe("partner");
        expect(blob("payer")).toBe("apify");
        expect(point?.doubles?.[0]).toBe(usdToMicros(PRICING.fetch.basic));
    });

    it("refuses a wrong partner secret with 401, never an x402 challenge", async () => {
        const res = await fetchBasic({ [HEADER]: "not-the-secret" });

        expect(res.status).toBe(401);
        expect(res.headers.get("PAYMENT-REQUIRED")).toBeNull();
        expect(await res.json<Record<string, unknown>>()).toMatchObject({ code: "INVALID_PARTNER_KEY" });
    });

    it("validates the body strictly, like any paying call", async () => {
        const res = await fetchBasic({ [HEADER]: "test-partner-secret" }, {});

        expect(res.status).toBe(400);
    });

    it("leaves a call without the partner header on the x402 path", async () => {
        vi.restoreAllMocks(); // the facilitator must answer for real to build the challenge
        const res = await fetchBasic({});

        expect(res.status).toBe(402);
        expect(res.headers.get("PAYMENT-REQUIRED")).not.toBeNull();
    });
});
