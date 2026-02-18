
import { describe, it, expect } from "vitest";
import { getDiscount } from "../../src/services/reputation";

describe("Reputation Service", () => {
    describe("getDiscount", () => {
        it("should return 0 for undefined address", () => {
            expect(getDiscount(undefined)).toBe(0);
        });

        it("should return 0 for unknown address", () => {
            expect(getDiscount("0x1234567890abcdef")).toBe(0);
        });

        it("should return 0 for empty string", () => {
            expect(getDiscount("")).toBe(0);
        });

        it("should return 20% discount for 0xweb prefix", () => {
            expect(getDiscount("0xweb1234")).toBe(0.20);
        });

        it("should return 50% discount for 0xvip prefix", () => {
            expect(getDiscount("0xvip5678")).toBe(0.50);
        });

        it("should return 10% discount for 0xbaz prefix", () => {
            expect(getDiscount("0xbaz9abc")).toBe(0.10);
        });

        it("should be case-insensitive", () => {
            expect(getDiscount("0xWEB1234")).toBe(0.20);
            expect(getDiscount("0xVIP5678")).toBe(0.50);
            expect(getDiscount("0xBAZ9abc")).toBe(0.10);
        });

        it("should return discount values between 0 and 1", () => {
            const addresses = [
                "0xweb1234",
                "0xvip5678",
                "0xbaz9abc",
                "0xunknown",
                undefined,
            ];

            for (const addr of addresses) {
                const discount = getDiscount(addr);
                expect(discount).toBeGreaterThanOrEqual(0);
                expect(discount).toBeLessThanOrEqual(1);
            }
        });
    });
});
