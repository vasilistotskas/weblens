/**
 * Wallet auth on the credits endpoints, through the real Worker.
 *
 * ~2.1k callers a week reach /credits/balance and /credits/history without
 * credentials. They used to get "Missing authentication headers" — which named
 * no header and no signing format — coded INVALID_REQUEST, a 400 code returned
 * on a 401. Worse, `verifyWalletSignature` computes a precise reason (expired
 * timestamp, malformed address, bad signature) and both handlers discarded it
 * for a blanket PAYMENT_FAILED, so a caller with a clock skew problem and a
 * caller with a broken signature saw the same thing.
 */

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://api.weblens.dev";
const WALLET_PATHS = ["/credits/balance", "/credits/history"];
/** Well-formed but not the signer — enough to reach signature verification. */
const WALLET = "0x1369f9899B0Eb899336A196003c86262997e7567";
const FAKE_SIG = `0x${"ab".repeat(65)}`;

async function get(path: string, headers: Record<string, string> = {}) {
    const res = await SELF.fetch(`${ORIGIN}${path}`, { headers });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe.each(WALLET_PATHS)("wallet auth on %s", (path) => {
    it("names every missing header and the exact string to sign", async () => {
        const { status, body } = await get(path);

        expect(status).toBe(401);
        expect(body.code).toBe("MISSING_AUTH");
        expect(body.error).toBe(body.code);
        for (const header of ["X-CREDIT-WALLET", "X-CREDIT-SIGNATURE", "X-CREDIT-TIMESTAMP"]) {
            expect(body.message as string, `names ${header}`).toContain(header);
        }
        // The signing format must be stated, not implied.
        expect(body.message as string).toContain("WebLens Authentication");
    });

    it("names only the headers actually missing", async () => {
        const { body } = await get(path, { "X-CREDIT-WALLET": WALLET });

        expect(body.message as string).toContain("X-CREDIT-SIGNATURE");
        expect(body.message as string).toContain("X-CREDIT-TIMESTAMP");
        // Present headers must not be listed as missing. The signing-format
        // sentence mentions every header by name, so scope this to the list.
        const listed = (body.message as string).split(".")[0];
        expect(listed).not.toContain("X-CREDIT-WALLET");
    });

    it.each([
        ["not-a-number", "INVALID_TIMESTAMP"],
        [String(Date.now() - 10 * 60 * 1000), "EXPIRED_TIMESTAMP"],
        [String(Date.now() + 10 * 60 * 1000), "INVALID_TIMESTAMP"],
    ])("propagates the specific reason for timestamp %s", async (timestamp, expected) => {
        const { status, body } = await get(path, {
            "X-CREDIT-WALLET": WALLET,
            "X-CREDIT-SIGNATURE": FAKE_SIG,
            "X-CREDIT-TIMESTAMP": timestamp,
        });

        expect(status).toBe(401);
        expect(body.code).toBe(expected);
    });

    it("reports a malformed wallet distinctly from a bad signature", async () => {
        const { status, body } = await get(path, {
            "X-CREDIT-WALLET": "0xnothex",
            "X-CREDIT-SIGNATURE": FAKE_SIG,
            "X-CREDIT-TIMESTAMP": String(Date.now()),
        });

        expect(status).toBe(401);
        expect(body.code).toBe("INVALID_WALLET");
    });

    it("reports a signature that does not verify as such", async () => {
        const { status, body } = await get(path, {
            "X-CREDIT-WALLET": WALLET,
            "X-CREDIT-SIGNATURE": FAKE_SIG,
            "X-CREDIT-TIMESTAMP": String(Date.now()),
        });

        expect(status).toBe(401);
        expect(["INVALID_SIGNATURE", "VERIFICATION_FAILED"]).toContain(body.code);
    });

    it("never reports a wallet-auth failure as PAYMENT_FAILED or INVALID_REQUEST", async () => {
        // Both were previously returned on 401 responses; INVALID_REQUEST maps
        // to 400 in getHttpStatus, so the code contradicted the status.
        const cases = [
            {},
            { "X-CREDIT-WALLET": WALLET },
            { "X-CREDIT-WALLET": WALLET, "X-CREDIT-SIGNATURE": FAKE_SIG, "X-CREDIT-TIMESTAMP": String(Date.now()) },
        ];
        for (const headers of cases) {
            const { body } = await get(path, headers);
            expect(["PAYMENT_FAILED", "INVALID_REQUEST"]).not.toContain(body.code);
        }
    });
});
