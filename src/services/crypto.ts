import type { Env } from "../types";

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
): Promise<{ signature: string; publicKey: string }> {

    // payload to sign
    const payload = JSON.stringify({ url, hash: contentHash, timestamp });
    const encoder = new TextEncoder();
    const data = encoder.encode(payload);

    // 1. Get/Import the signing key
    const secretKey = env.CDP_API_KEY_SECRET;
    if (!secretKey) {
        throw new Error("Missing CDP_API_KEY_SECRET for signing");
    }

    // HMAC-SHA256 signing for stable oracle proofs across worker restarts.
    // For true ECDSA, provision env.SIGNING_PRIVATE_KEY and upgrade this path.
    try {
        const key = await subtle.importKey(
            "raw",
            encoder.encode(secretKey),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );

        const signatureBuffer = await subtle.sign(
            "HMAC",
            key,
            data
        );

        const signatureArray = Array.from(new Uint8Array(signatureBuffer));
        const signatureHex = signatureArray.map((b) => b.toString(16).padStart(2, "0")).join("");

        return {
            signature: signatureHex,
            publicKey: "WebLens-Oracle-v1-HMAC" // Indicating this is a symmetric oracle proof
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
): Promise<{ hash: string; timestamp: string; signature: string; publicKey: string }> {
    const hash = await hashContent(content);
    const timestamp = new Date().toISOString();
    const { signature, publicKey } = await signContext(url, hash, timestamp, env);
    return { hash, timestamp, signature, publicKey };
}
