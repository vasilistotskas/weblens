/**
 * PayAI facilitator authentication
 * (https://docs.payai.network/x402/facilitators/authentication).
 *
 * Settling beyond PayAI's free tier needs an API key: each /verify and
 * /settle request carries `Authorization: Bearer <jwt>`, an EdDSA (Ed25519)
 * JWT signed with the key's secret. PayAI rejects an invalid credential
 * outright instead of downgrading to anonymous access, so callers attach this
 * only when both halves of the key are configured. /supported is public and
 * gets no token.
 */

/** Token lifetime PayAI's reference implementation uses (exp = iat + 120). */
const TOKEN_LIFETIME_SECONDS = 120;
/** Re-sign this long before expiry so a request never carries a token that lapses in flight. */
const REFRESH_MARGIN_SECONDS = 30;
const ISSUER = "payai-merchant";
const SECRET_PREFIX = "payai_sk_";

type AuthHeaders = Record<string, string>;

/** The per-path headers `HTTPFacilitatorClient`'s `createAuthHeaders` must return. */
export interface FacilitatorAuthHeaders {
    verify: AuthHeaders;
    settle: AuthHeaders;
}

function base64UrlEncode(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) { binary += String.fromCharCode(byte); }
    return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

const encodeJson = (value: object): string => base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));

/** The secret is `payai_sk_` + base64 of an Ed25519 private key in PKCS#8 DER form. */
async function importSigningKey(secret: string): Promise<CryptoKey> {
    const trimmed = secret.trim();
    const encoded = trimmed.startsWith(SECRET_PREFIX) ? trimmed.slice(SECRET_PREFIX.length) : trimmed;
    const der = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    return crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, false, ["sign"]);
}

/** Sign a fresh PayAI JWT for `keyId`, valid for TOKEN_LIFETIME_SECONDS from `nowSeconds`. */
export async function signPayAIJwt(keyId: string, key: CryptoKey, nowSeconds: number): Promise<string> {
    const header = encodeJson({ alg: "EdDSA", typ: "JWT", kid: keyId });
    const payload = encodeJson({
        sub: keyId,
        iss: ISSUER,
        iat: nowSeconds,
        exp: nowSeconds + TOKEN_LIFETIME_SECONDS,
        jti: crypto.randomUUID(),
    });
    const signingInput = `${header}.${payload}`;
    const signature = await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(signingInput));
    return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * A `createAuthHeaders` implementation for PayAI. The signing key is imported
 * once, and a token is reused until it is within REFRESH_MARGIN_SECONDS of
 * expiry, so a busy isolate signs at most one token per ~90 seconds.
 */
export function payaiAuthHeaders(
    keyId: string,
    secret: string,
    now: () => number = () => Math.floor(Date.now() / 1000),
): () => Promise<FacilitatorAuthHeaders> {
    let signingKey: Promise<CryptoKey> | undefined;
    let cached: { token: string; expiresAt: number } | undefined;
    return async () => {
        const nowSeconds = now();
        if (!cached || cached.expiresAt - nowSeconds <= REFRESH_MARGIN_SECONDS) {
            signingKey ??= importSigningKey(secret);
            cached = { token: await signPayAIJwt(keyId, await signingKey, nowSeconds), expiresAt: nowSeconds + TOKEN_LIFETIME_SECONDS };
        }
        const headers = { Authorization: `Bearer ${cached.token}` };
        return { verify: headers, settle: headers };
    };
}
