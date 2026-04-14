import { describe, it, expect } from "vitest";
import { verifyStripeSignature } from "../../src/services/stripe";

async function hmacHex(secret: string, message: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
    return Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

describe("verifyStripeSignature", () => {
    const secret = "whsec_test_secret_abc123";
    const payload = JSON.stringify({ id: "evt_123", type: "checkout.session.completed" });

    it("accepts a valid signature within tolerance", async () => {
        const t = Math.floor(Date.now() / 1000);
        const sig = await hmacHex(secret, `${String(t)}.${payload}`);
        const header = `t=${String(t)},v1=${sig}`;

        const result = await verifyStripeSignature({ secret, payload, header });
        expect(result.valid).toBe(true);
    });

    it("rejects missing header", async () => {
        const result = await verifyStripeSignature({ secret, payload, header: null });
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/Missing/u);
    });

    it("rejects header without timestamp", async () => {
        const result = await verifyStripeSignature({
            secret,
            payload,
            header: "v1=deadbeef",
        });
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/timestamp/u);
    });

    it("rejects header without v1 signature", async () => {
        const result = await verifyStripeSignature({
            secret,
            payload,
            header: "t=1700000000",
        });
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/v1/u);
    });

    it("rejects stale timestamp outside tolerance", async () => {
        const oldT = Math.floor(Date.now() / 1000) - 3600; // 1 hour old
        const sig = await hmacHex(secret, `${String(oldT)}.${payload}`);
        const header = `t=${String(oldT)},v1=${sig}`;

        const result = await verifyStripeSignature({ secret, payload, header });
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/tolerance/u);
    });

    it("rejects tampered payload", async () => {
        const t = Math.floor(Date.now() / 1000);
        const sig = await hmacHex(secret, `${String(t)}.${payload}`);
        const header = `t=${String(t)},v1=${sig}`;

        const tampered = payload.replace("checkout", "tampered");
        const result = await verifyStripeSignature({
            secret,
            payload: tampered,
            header,
        });
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/mismatch/u);
    });

    it("rejects signature signed with wrong secret", async () => {
        const t = Math.floor(Date.now() / 1000);
        const sig = await hmacHex("whsec_different_secret", `${String(t)}.${payload}`);
        const header = `t=${String(t)},v1=${sig}`;

        const result = await verifyStripeSignature({ secret, payload, header });
        expect(result.valid).toBe(false);
        expect(result.reason).toMatch(/mismatch/u);
    });

    it("accepts when any of multiple v1 signatures matches (rotation scenario)", async () => {
        const t = Math.floor(Date.now() / 1000);
        const goodSig = await hmacHex(secret, `${String(t)}.${payload}`);
        const header = `t=${String(t)},v1=0000deadbeef,v1=${goodSig}`;

        const result = await verifyStripeSignature({ secret, payload, header });
        expect(result.valid).toBe(true);
    });
});
