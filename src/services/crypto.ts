import type { Env, ProofOfContext } from "../types";

const subtle = crypto.subtle;

/**
 * Calculate SHA-256 hash of the content (DOM/Text)
 * @param content based on which to calculate hash
 * @returns Hex string of the hash
 */
export async function hashContent(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await subtle.digest("SHA-256", data);

    // Convert buffer to hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    return hashHex;
}

/**
 * Sign the context data using the CDP Server Wallet (simulated for now with a local key if CDP direct signing isn't available)
 * 
 * NOTE: In a full production env with CDP Server Wallet, we would use the wallet.sign() method.
 * For this implementation, we will use a derived signing key from the CDP_API_KEY_SECRET 
 * (or a dedicated private key if available) to simulate the "Server Wallet" signature 
 * until the CDP SDK fully exposes arbitrary message signing in this environment.
 * 
 * This provides the PROOF that WebLens (holder of the secret) verified this data.
 */
export async function signContext(
    url: string,
    contentHash: string,
    timestamp: string,
    env: Env
): Promise<{ mac: string; keyId: string; alg: string }> {

    // payload to authenticate
    const payload = JSON.stringify({ url, hash: contentHash, timestamp });
    const encoder = new TextEncoder();
    const data = encoder.encode(payload);

    // Prefer a dedicated signing secret; fall back to the CDP secret only when
    // that's all that's configured (avoids overloading the payment credential).
    const secretKey = env.SIGNING_PRIVATE_KEY ?? env.CDP_API_KEY_SECRET;
    if (!secretKey) {
        throw new Error("Missing signing secret (SIGNING_PRIVATE_KEY or CDP_API_KEY_SECRET)");
    }

    // NOTE: This produces a SYMMETRIC HMAC tag (a MAC), not a public-key
    // signature — only the secret holder can verify it, so it is NOT
    // third-party verifiable. The field names reflect that. ECDSA is a roadmap
    // item (would publish a real verifying key).
    try {
        const key = await subtle.importKey(
            "raw",
            encoder.encode(secretKey),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );

        const macBuffer = await subtle.sign("HMAC", key, data);
        const macHex = Array.from(new Uint8Array(macBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");

        return {
            mac: macHex,
            keyId: "weblens-oracle-v1",
            alg: "HMAC-SHA256",
        };
    } catch (e) {
        console.error("Signing failed", e);
        throw new Error("Internal signing error");
    }
}

/**
 * Create a full Proof of Context envelope
 */
export async function createProofOfContext(
    url: string,
    content: string,
    env: Env
): Promise<ProofOfContext> {
    const hash = await hashContent(content);
    const timestamp = new Date().toISOString();
    const { mac, keyId, alg } = await signContext(url, hash, timestamp, env);
    return { hash, timestamp, alg, mac, keyId };
}
