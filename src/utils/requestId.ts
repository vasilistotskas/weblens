/**
 * Request ID Generator Utility
 * Generates unique request IDs for tracing and debugging
 * 
 * Format: wl_{timestamp}_{random}
 * Example: wl_m5x7k2_a3b9c1
 * 
 * Requirements: 5.3
 */

/**
 * Generate a unique request ID with the wl_ prefix
 * 
 * @returns A unique request ID string in format wl_{timestamp}_{random}
 */
export function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  // Use WebCrypto UUID rather than Math.random so IDs can never collide
  // across concurrent requests — collisions would confuse dedup keys used
  // by the credit DO and x402 retries.
  const random = crypto.randomUUID().replace(/-/gu, "").slice(0, 8);
  return `wl_${timestamp}_${random}`;
}
