/**
 * Security Headers Middleware
 * Adds security headers to all responses
 */

import type { Context, Next } from "hono";

/**
 * Security headers for API (JSON) responses.
 *
 * Cross-Origin-Resource-Policy is `cross-origin` for API responses so browser
 * clients on other origins (paywall widgets, dashboards, x402 SDKs embedded
 * in third-party sites) can fetch us. HTML pages have their own header set
 * below where same-origin is appropriate.
 */
const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "0",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "interest-cohort=(), geolocation=(), microphone=(), camera=()",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  // Allow JSON API responses to be embedded by third-party origins.
  // This is required for browser-based x402 clients to call us cross-origin.
  "Cross-Origin-Resource-Policy": "cross-origin",
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
 * Relaxed security headers for landing page (inline tryFetch script)
 */
const LANDING_SECURITY_HEADERS = {
  ...SECURITY_HEADERS,
  "Content-Security-Policy":
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "connect-src 'self'; " +
    "img-src 'self' data:; " +
    "frame-ancestors 'none'",
};

/**
 * Headers to remove (information disclosure)
 */
const BLOCKED_HEADERS = ["X-Powered-By", "Server"];

/**
 * Relaxed security headers for dashboard (needs to load Tailwind, Modules, etc.)
 */
const DASHBOARD_SECURITY_HEADERS = {
  ...SECURITY_HEADERS,
  "Content-Security-Policy":
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://esm.sh https://static.cloudflareinsights.com; " +
    "style-src 'self' 'unsafe-inline'; " +
    "connect-src 'self' https:; " +
    "img-src 'self' data: https:; " +
    "worker-src 'self' blob:; " +
    "frame-ancestors 'none'",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

/**
 * Security middleware - adds security headers to all responses
 */
export async function securityMiddleware(c: Context, next: Next) {
  await next();

  // Use relaxed CSP for documentation and dashboard pages
  const path = c.req.path;
  const isDocsPage = path === "/docs" || path.startsWith("/docs/");
  const isDashboardPage = path === "/dashboard";
  const isLandingPage = path === "/" && c.req.header("Accept")?.includes("text/html");

  let headers = SECURITY_HEADERS;
  if (isDocsPage) {
    headers = DOCS_SECURITY_HEADERS;
  } else if (isDashboardPage) {
    headers = DASHBOARD_SECURITY_HEADERS;
  } else if (isLandingPage) {
    headers = LANDING_SECURITY_HEADERS;
  }

  // Add security headers
  for (const [name, value] of Object.entries(headers)) {
    c.header(name, value);
  }

  // Remove potentially sensitive headers
  for (const name of BLOCKED_HEADERS) {
    c.res.headers.delete(name);
  }
}
