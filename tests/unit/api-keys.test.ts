import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CREDIT_PACKS, packPrice } from "../../src/config";
import { assertMicros } from "../../src/durable_objects/CreditAccountDO";
import { formatApiKey, newAccountId, parseApiKey } from "../../src/services/accounts";
import { formatMicros, usdToMicros } from "../../src/services/pricing";
import { isCreditPack, packCents } from "../../src/services/stripe";

const SECRET = "A".repeat(43);

describe("usdToMicros / formatMicros", () => {
    it.each([
        ["$0.002", 2_000],
        ["$0.0015", 1_500],
        ["$0.015", 15_000],
        ["$10", 10_000_000],
        ["0.35", 350_000],
        ["$0.000001", 1],
    ])("%s is %i micro-USD", (price, micros) => {
        expect(usdToMicros(price)).toBe(micros);
    });

    it.each(["$-1", "$1.0000001", "", "$", "abc", "$1e3"])("refuses %j", (price) => {
        expect(() => usdToMicros(price)).toThrow(RangeError);
    });

    it("round-trips every 4-decimal price the resolvers produce", () => {
        fc.assert(fc.property(fc.integer({ min: 0, max: 10_000_000 }), (tenThousandths) => {
            const price = `$${(tenThousandths / 10_000).toFixed(4)}`;
            expect(usdToMicros(formatMicros(usdToMicros(price)))).toBe(usdToMicros(price));
        }));
    });

    it("formats without trailing zeros", () => {
        expect(formatMicros(998_000)).toBe("$0.998");
        expect(formatMicros(10_000_000)).toBe("$10");
        expect(formatMicros("15000")).toBe("$0.015");
    });
});

describe("assertMicros (every ledger amount)", () => {
    it.each([0, -5, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("refuses %s", (micros) => {
        expect(() => assertMicros(micros)).toThrow(/positive whole number/u);
    });

    it("accepts a positive whole number", () => {
        expect(() => assertMicros(1)).not.toThrow();
    });
});

describe("parseApiKey", () => {
    const accountId = newAccountId();
    const key = formatApiKey("wl_live_", accountId, SECRET);

    it("reads the account id and secret from a bearer key", () => {
        expect(parseApiKey(`Bearer ${key}`, "wl_live_")).toEqual({ accountId, secret: SECRET });
        expect(parseApiKey(`bearer   ${key}`, "wl_live_")).toEqual({ accountId, secret: SECRET });
    });

    it("ignores credentials that are not WebLens keys, so those calls keep the x402 path", () => {
        expect(parseApiKey(undefined, "wl_live_")).toBe("none");
        expect(parseApiKey("", "wl_live_")).toBe("none");
        // An MCP client's own login token, a proxy's credential.
        expect(parseApiKey("Bearer eyJhbGciOiJIUzI1NiIs.payload.sig", "wl_live_")).toBe("none");
        expect(parseApiKey("Basic dXNlcjpwYXNz", "wl_live_")).toBe("none");
        expect(parseApiKey(`Basic ${key}`, "wl_live_")).toBe("none");
    });

    it("refuses a WebLens key in the wrong shape", () => {
        expect(parseApiKey(key, "wl_live_")).toBe("invalid");
        expect(parseApiKey(`Bearer ${key}x`, "wl_live_")).toBe("invalid");
        expect(parseApiKey("Bearer wl_live_short", "wl_live_")).toBe("invalid");
    });

    it("accepts a key only in the environment that sold it", () => {
        expect(parseApiKey(`Bearer ${key}`, "wl_test_")).toBe("invalid");
        expect(parseApiKey(`Bearer ${formatApiKey("wl_test_", accountId, SECRET)}`, "wl_test_")).toEqual({ accountId, secret: SECRET });
    });

    it("makes 128-bit hex account ids", () => {
        const ids = new Set(Array.from({ length: 100 }, newAccountId));
        expect(ids.size).toBe(100);
        for (const id of ids) { expect(id).toMatch(/^[0-9a-f]{32}$/u); }
    });
});

describe("credit packs", () => {
    it("are sold at face value, from $10", () => {
        expect(CREDIT_PACKS.map(packPrice)).toEqual(["$10", "$50", "$100"]);
        expect(CREDIT_PACKS.map(packCents)).toEqual([1000, 5000, 10000]);
    });

    it("recognises only the packs on sale", () => {
        expect(isCreditPack("10")).toBe(true);
        expect(isCreditPack("5")).toBe(false);
        expect(isCreditPack("toString")).toBe(false);
        expect(isCreditPack(undefined)).toBe(false);
    });
});
