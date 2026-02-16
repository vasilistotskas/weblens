import { verifyMessage } from "viem";

/**
 * Security Utility
 * 
 * Provides centralized functions for:
 * - Signature verification (EIP-191)
 * - Timestamp validation (Replay protection)
 * - Wallet ownership proof
 */

export interface VerificationResult {
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

    // 3. Reconstruct the message
    // This exact format must be used by the client when signing!
    const message = `WebLens Authentication\nWallet: ${walletAddress}\nTimestamp: ${timestamp}`;

    try {
        // 4. Verify signature using viem
        // verifyMessage handles EIP-191 prefixing automatically
        const valid = await verifyMessage({
            address: walletAddress as `0x${string}`,
            message: message,
            signature: signature as `0x${string}`,
        });

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
