/**
 * Favicon assets, served straight from the Worker (no static-asset binding).
 *
 * The WebLens mark: a gradient lens (brand blue #60a5fa -> purple #c084fc)
 * on the dark landing background. Raster assets were pre-rendered at 512px
 * with Lanczos downscaling (16/32/48 in the ICO, 48px PNG) and embedded as
 * base64 so the Worker stays dependency-free. x402scan's origin checker
 * probes /favicon.ico, /favicon.png, and /favicon.svg.
 */

import type { Context } from "hono";
import type { Env } from "../types";

export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#60a5fa"/>
      <stop offset="1" stop-color="#c084fc"/>
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="7" fill="#111"/>
  <circle cx="16" cy="16" r="9.5" fill="none" stroke="url(#g)" stroke-width="2.5"/>
  <circle cx="16" cy="16" r="4.5" fill="url(#g)"/>
  <circle cx="18.2" cy="13.4" r="1.6" fill="#e0f2fe" opacity="0.9"/>
</svg>`;

const FAVICON_ICO_B64 =
    "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";

const FAVICON_PNG_B64 =
    "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";

function decode(b64: string): ArrayBuffer {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

const CACHE_HEADERS = {
    // Immutable-ish: favicons change rarely; a day of caching keeps
    // browser-tab and crawler traffic off the Worker.
    "Cache-Control": "public, max-age=86400",
};

export function faviconSvgHandler(c: Context<{ Bindings: Env }>) {
    return c.body(FAVICON_SVG, 200, {
        ...CACHE_HEADERS,
        "Content-Type": "image/svg+xml",
    });
}

export function faviconIcoHandler(c: Context<{ Bindings: Env }>) {
    return c.body(decode(FAVICON_ICO_B64), 200, {
        ...CACHE_HEADERS,
        "Content-Type": "image/x-icon",
    });
}

export function faviconPngHandler(c: Context<{ Bindings: Env }>) {
    return c.body(decode(FAVICON_PNG_B64), 200, {
        ...CACHE_HEADERS,
        "Content-Type": "image/png",
    });
}
