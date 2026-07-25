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

// Private/internal IPv6 string patterns. IPv4 (in every encoding) is handled by
// canonical parsing in parseIPv4() below, not by regex.
const PRIVATE_IPV6_PATTERNS = [
  /^::ffff:/i,                                     // IPv4-mapped IPv6 (::ffff:127.0.0.1)
  /^0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:ffff:/i,    // IPv4-mapped long form
  /^f[cd][0-9a-f]{2}:/i,                           // IPv6 ULA fc00::/7 (fc00 + fd00)
  /^fe80:/i,                                       // IPv6 Link Local
  /^2001:db8:/i,                                   // IPv6 Documentation (RFC 3849)
  /^2002:/i,                                       // 6to4 relay (can map to private v4)
];

// Allowed protocols
const ALLOWED_PROTOCOLS = ["http:", "https:"];

/** A standard dotted-quad decimal IPv4 like "203.0.113.5" (each octet 0-255). */
function isCanonicalDottedQuad(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host);
  if (!m) { return false; }
  return m.slice(1).every((octet) => Number(octet) <= 255);
}

/**
 * Parse an IPv4 literal in ANY `inet_aton`-style encoding — dotted decimal,
 * octal, or hex octets, 1–3 part shorthand (`127.1`), or a bare 32-bit integer
 * (`2130706433`) — into its unsigned 32-bit value. Returns null when `host` is
 * not an IPv4 literal (e.g. a normal domain). Canonicalizing first is the only
 * reliable SSRF defense per OWASP; regexes alone miss octal/hex/short forms.
 */
function parseIPv4(host: string): number | null {
  const parts = host.split(".");
  if (parts.length === 0 || parts.length > 4) { return null; }

  const nums: number[] = [];
  for (const part of parts) {
    let n: number;
    if (/^0x[0-9a-f]+$/iu.test(part)) { n = parseInt(part, 16); }
    else if (/^0[0-7]+$/u.test(part)) { n = parseInt(part, 8); }
    else if (/^[0-9]+$/u.test(part)) { n = parseInt(part, 10); }
    else { return null; }
    if (!Number.isFinite(n) || n < 0) { return null; }
    nums.push(n);
  }

  // nums has 1–4 entries. The last part absorbs the remaining octets; each
  // leading part must fit in one octet.
  const lastValue = nums.at(-1);
  if (lastValue === undefined) { return null; }
  const leading = nums.slice(0, -1);
  if (leading.some((v) => v > 0xff)) { return null; }
  const maxLast = 2 ** (8 * (4 - nums.length + 1));
  if (lastValue >= maxLast) { return null; }

  let ip = lastValue;
  leading.forEach((v, i) => {
    ip += v * 2 ** (8 * (4 - 1 - i));
  });
  return ip >>> 0;
}

/** Range-check a 32-bit IPv4 against private/internal blocks. */
function isPrivateIPv4(ip: number): boolean {
  const octets = (a: number, b: number, c: number, d: number) =>
    ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  const inBlock = (base: number, prefix: number) =>
    ip >>> (32 - prefix) === base >>> (32 - prefix);
  return (
    inBlock(octets(10, 0, 0, 0), 8) ||         // RFC1918
    inBlock(octets(172, 16, 0, 0), 12) ||      // RFC1918
    inBlock(octets(192, 168, 0, 0), 16) ||     // RFC1918
    inBlock(octets(169, 254, 0, 0), 16) ||     // link-local
    inBlock(octets(127, 0, 0, 0), 8) ||        // loopback
    inBlock(octets(0, 0, 0, 0), 8) ||          // "this" network
    inBlock(octets(100, 64, 0, 0), 10) ||      // CGNAT (RFC6598)
    inBlock(octets(198, 18, 0, 0), 15) ||      // benchmark (RFC2544)
    ip === octets(255, 255, 255, 255)          // broadcast
  );
}

/**
 * Check if a hostname is blocked (internal/private/obfuscated).
 */
function isBlockedHost(hostname: string): boolean {
  // Strip IPv6 brackets and lowercase.
  const host = hostname.replace(/^\[/u, "").replace(/\]$/u, "").toLowerCase();

  if (BLOCKED_HOSTS.includes(host)) { return true; }
  if (BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(host))) { return true; }

  // IPv4 literal in any encoding: block if private, AND block all non-canonical
  // encodings (octal/hex/shorthand/bare-int) — legitimate callers send dotted
  // quads; the obfuscated forms are SSRF evasion.
  const ipv4 = parseIPv4(host);
  if (ipv4 !== null) {
    return isPrivateIPv4(ipv4) || !isCanonicalDottedQuad(host);
  }

  // IPv6 / mapped forms.
  if (PRIVATE_IPV6_PATTERNS.some((pattern) => pattern.test(host))) { return true; }

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

    // Block URLs that embed userinfo (https://user:pass@host). Some HTTP
    // clients normalize these in confusing ways that can smuggle the real
    // target host past a naïve allow-list; refusing them outright is the
    // safest SSRF defense.
    if (url.username || url.password) {
      return {
        valid: false,
        error: "URLs with embedded credentials are not allowed"
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
