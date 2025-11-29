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
 * Relaxed security headers for documentation pages (needs to load Scalar UI)
 */
const DOCS_SECURITY_HEADERS = {
  ...SECURITY_HEADERS,
  // Allow Scalar API reference scripts and styles
  "Content-Security-Policy": 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://static.cloudflareinsights.com; " +
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net data:; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self' https:; " +
    "frame-ancestors 'none'",
  // Allow cross-origin for docs assets
  "Cross-Origin-Resource-Policy": "cross-origin",
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

  // Use relaxed CSP for documentation pages
  const isDocsPage = c.req.path === "/docs" || c.req.path.startsWith("/docs/");
  const headers = isDocsPage ? DOCS_SECURITY_HEADERS : SECURITY_HEADERS;

  // Add security headers
  for (const [name, value] of Object.entries(headers)) {
    c.header(name, value);
  }

  // Remove potentially sensitive headers
  for (const name of BLOCKED_HEADERS) {
    c.res.headers.delete(name);
  }
}
