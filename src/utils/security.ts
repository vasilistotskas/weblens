import { getAddress, verifyMessage } from "viem";

/**
 * Security Utility
 * 
 * Provides centralized functions for:
 * - Signature verification (EIP-191)
 * - Timestamp validation (Replay protection)
 * - Wallet ownership proof
 */

interface VerificationResult {
    isValid: boolean;
    error?: string;
    code?: string;
}

/**
 * Verify a request signature for wallet ownership.
 * 
 * Expects headers:
 * - X-CREDIT-WALLET: The wallet address claiming to make the request
 * - X-CREDIT-SIGNATURE: The signature of the message
 * - X-CREDIT-TIMESTAMP: The timestamp included in the signature message
 * 
 * The expected message format is:
 * `WebLens Authentication\nWallet: <wallet_address>\nTimestamp: <timestamp>`
 * 
 * @param walletAddress - The claimed wallet address (0x...)
 * @param signature - The signature hex string
 * @param timestamp - The timestamp string
 * @returns VerificationResult
 */
export async function verifyWalletSignature(
    walletAddress: string,
    signature: string,
    timestamp: string,
): Promise<VerificationResult> {

    // 1. Validate inputs
    if (!walletAddress || !signature || !timestamp) {
        return { isValid: false, error: "Missing required authentication headers", code: "MISSING_AUTH" };
    }

    // 2. Validate timestamp (Replay Protection - 5 minute window)
    const timestampNum = parseInt(timestamp);
    if (isNaN(timestampNum)) {
        return { isValid: false, error: "Invalid timestamp format", code: "INVALID_TIMESTAMP" };
    }

    const now = Date.now();
    const timeDiff = Math.abs(now - timestampNum);
    // 5 minutes = 300,000 ms
    if (timeDiff > 5 * 60 * 1000) {
        return { isValid: false, error: "Request expired or timestamp out of range", code: "EXPIRED_TIMESTAMP" };
    }

    // 3. Reconstruct the message. Try both the raw form and the checksum
    // form — different client libs normalize case differently when signing,
    // and rejecting one form while accepting the other silently breaks auth
    // for perfectly valid callers.
    let checksummed: `0x${string}`;
    try {
        checksummed = getAddress(walletAddress);
    } catch {
        return { isValid: false, error: "Malformed wallet address", code: "INVALID_WALLET" };
    }
    const messages = [
        `WebLens Authentication\nWallet: ${walletAddress}\nTimestamp: ${timestamp}`,
        `WebLens Authentication\nWallet: ${checksummed}\nTimestamp: ${timestamp}`,
        `WebLens Authentication\nWallet: ${walletAddress.toLowerCase()}\nTimestamp: ${timestamp}`,
    ];

    try {
        // 4. Verify signature using viem. Accept any of the three canonical
        // forms (raw / EIP-55 checksum / lowercase) — the DO lookup later
        // normalizes via toLowerCase so which one was signed is irrelevant.
        let valid = false;
        for (const message of messages) {
            if (await verifyMessage({
                address: checksummed,
                message,
                signature: signature as `0x${string}`,
            })) {
                valid = true;
                break;
            }
        }

        if (!valid) {
            return { isValid: false, error: "Invalid signature", code: "INVALID_SIGNATURE" };
        }

        return { isValid: true };

    } catch (error) {
        return {
            isValid: false,
            error: `Signature verification failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            code: "VERIFICATION_FAILED"
        };
    }
}
