/**
 * URL Validator Service
 * Validates and normalizes URLs, blocking internal/private addresses
 * 
 * Requirements: 1.1, 5.4
 */

import type { URLValidationResult } from "../types";

// Blocked hostnames - internal/private addresses
const BLOCKED_HOSTS = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
];

// Blocked hostname patterns (wildcards)
const BLOCKED_HOST_PATTERNS = [
  /\.local$/i,
  /\.internal$/i,
  /\.localhost$/i,
  /\.onion$/i, // TOR
];

// Private IP ranges (RFC 1918 and others) including Hex/Octal/Decimal formats
// This is hard to catch with regex alone for all exotic formats, but these cover standards.
const PRIVATE_IP_PATTERNS = [
  /^10\./,                             // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[0-1])\./,       // 172.16.0.0/12
  /^192\.168\./,                       // 192.168.0.0/16
  /^169\.254\./,                       // Link-local
  /^127\./,                            // Loopback
  /^0\./,                               // Current network
  /^fc00:/i,                           // IPv6 Unique Local
  /^fe80:/i,                           // IPv6 Link Local
  /^0x/i,                              // Hexadecimal IP attempts (simple block)
  /^0[0-9]/,                           // Octal attempts (simple block)
];

// Allowed protocols
const ALLOWED_PROTOCOLS = ["http:", "https:"];

/**
 * Check if a hostname is blocked
 */
function isBlockedHost(hostname: string): boolean {
  const lowerHostname = hostname.toLowerCase();

  // Check exact matches
  if (BLOCKED_HOSTS.includes(lowerHostname)) {
    return true;
  }

  // Check patterns
  if (BLOCKED_HOST_PATTERNS.some(pattern => pattern.test(lowerHostname))) {
    return true;
  }

  // Check private IP ranges
  if (PRIVATE_IP_PATTERNS.some(pattern => pattern.test(lowerHostname))) {
    return true;
  }

  // Decimal IP check (e.g. 2130706433 for 127.0.0.1)
  // If it's a pure number, block it to be safe or parse it
  if (/^\d+$/.test(lowerHostname)) {
    return true; // Block pure decimal IPs
  }

  return false;
}

/**
 * Validate and normalize a URL
 * 
 * @param input - The URL string to validate
 * @returns URLValidationResult with validation status and normalized URL or error
 */
export function validateURL(input: string): URLValidationResult {
  // Handle empty or whitespace-only input
  if (!input.trim()) {
    return { valid: false, error: "URL is required" };
  }

  try {
    const url = new URL(input.trim());

    // Check protocol
    if (!ALLOWED_PROTOCOLS.includes(url.protocol)) {
      return {
        valid: false,
        error: "Only HTTP/HTTPS URLs allowed"
      };
    }

    // Check for blocked hosts
    if (isBlockedHost(url.hostname)) {
      return {
        valid: false,
        error: "Internal URLs not allowed"
      };
    }

    // Return normalized URL
    return {
      valid: true,
      normalized: url.toString()
    };
  } catch {
    return {
      valid: false,
      error: "Invalid URL format"
    };
  }
}

/**
 * Check if a URL is valid (convenience function)
 */
export function isValidURL(input: string): boolean {
  return validateURL(input).valid;
}
