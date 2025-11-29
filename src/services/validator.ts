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
];

// Private IP ranges (RFC 1918 and others)
const PRIVATE_IP_PATTERNS = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,           // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/, // 172.16.0.0/12
  /^192\.168\.\d{1,3}\.\d{1,3}$/,              // 192.168.0.0/16
  /^169\.254\.\d{1,3}\.\d{1,3}$/,              // Link-local
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,          // Loopback
  /^0\.0\.0\.0$/,                               // All interfaces
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
  if (!input || !input.trim()) {
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
