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
  const random = Math.random().toString(36).substring(2, 8);
  return `wl_${timestamp}_${random}`;
}

/**
 * Validate if a string is a valid WebLens request ID
 * 
 * @param id - The string to validate
 * @returns true if the string matches the request ID format
 */
export function isValidRequestId(id: string): boolean {
  // Pattern: wl_{base36 timestamp}_{6 char random}
  const pattern = /^wl_[a-z0-9]+_[a-z0-9]{1,6}$/;
  return pattern.test(id);
}

/**
 * Extract timestamp from a request ID
 * 
 * @param id - A valid request ID
 * @returns The timestamp as a Date, or null if invalid
 */
export function extractTimestamp(id: string): Date | null {
  if (!isValidRequestId(id)) {
    return null;
  }
  
  const parts = id.split("_");
  if (parts.length !== 3) {
    return null;
  }
  
  const timestamp = parseInt(parts[1], 36);
  if (isNaN(timestamp)) {
    return null;
  }
  
  return new Date(timestamp);
}
