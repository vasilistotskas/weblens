/**
 * Security Headers Middleware
 * Adds security headers to all responses
 */

import type { Context, Next } from "hono";

/**
 * Security headers for API responses
 */
const SECURITY_HEADERS = {
  // Enforce HTTPS for 2 years
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  // Prevent MIME-sniffing
  "X-Content-Type-Options": "nosniff",
  // Prevent clickjacking
  "X-Frame-Options": "DENY",
  // Disable XSS filter (modern browsers don't need it, can cause issues)
  "X-XSS-Protection": "0",
  // Control referrer information
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Disable browser features we don't need
  "Permissions-Policy": "interest-cohort=(), geolocation=(), microphone=(), camera=()",
  // Content Security Policy for API (JSON responses)
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  // Cross-origin policies
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

/**
 * Headers to remove (information disclosure)
 */
const BLOCKED_HEADERS = ["X-Powered-By", "Server"];

/**
 * Security middleware - adds security headers to all responses
 */
export async function securityMiddleware(c: Context, next: Next) {
  await next();

  // Add security headers
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    c.header(name, value);
  }

  // Remove potentially sensitive headers
  for (const name of BLOCKED_HEADERS) {
    c.res.headers.delete(name);
  }
}
