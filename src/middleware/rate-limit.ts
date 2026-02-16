/**
 * Rate Limiting Middleware for Free Tier
 * 
 * IP-based rate limiter using Cloudflare KV for storage.
 * Returns 429 Too Many Requests when limit is exceeded.
 */

import type { Context, Next } from "hono";
import { FREE_TIER } from "../config";
import type { Env } from "../types";

interface RateLimitEntry {
    count: number;
    resetAt: number; // Unix timestamp in seconds
}

/**
 * Get the client IP from Cloudflare headers
 */
function getClientIP(c: Context<{ Bindings: Env }>): string {
    return (
        c.req.header("cf-connecting-ip") ??
        c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
        c.req.header("x-real-ip") ??
        "unknown"
    );
}

/**
 * Rate limiting middleware for free tier endpoints.
 * Uses Cloudflare KV to track request counts per IP.
 */
export async function rateLimitMiddleware(
    c: Context<{ Bindings: Env }>,
    next: Next
) {
    const kv = c.env.CACHE;

    if (!kv) {
        // If KV is unavailable, allow request but log warning
        console.warn("⚠️ Rate limiting KV unavailable, allowing request");
        await next();
        return;
    }

    const ip = getClientIP(c);
    const kvKey = `${FREE_TIER.kvKeyPrefix}:${ip}`;
    const now = Math.floor(Date.now() / 1000);

    // Get current rate limit state
    let entry: RateLimitEntry | null = null;
    try {
        const stored = await kv.get(kvKey);
        if (stored) {
            entry = JSON.parse(stored) as RateLimitEntry;
        }
    } catch {
        // Ignore parse errors, treat as fresh
    }

    // Initialize or reset if window expired
    if (!entry || now >= entry.resetAt) {
        entry = {
            count: 0,
            resetAt: now + FREE_TIER.rateLimitWindowSeconds,
        };
    }

    // Check limit
    const remaining = FREE_TIER.maxRequestsPerHour - entry.count;

    if (remaining <= 0) {
        const retryAfter = entry.resetAt - now;

        c.header("X-RateLimit-Limit", String(FREE_TIER.maxRequestsPerHour));
        c.header("X-RateLimit-Remaining", "0");
        c.header("X-RateLimit-Reset", String(entry.resetAt));
        c.header("Retry-After", String(retryAfter));

        return c.json(
            {
                error: "RATE_LIMITED",
                code: "RATE_LIMITED",
                message: `Free tier limit exceeded (${FREE_TIER.maxRequestsPerHour} requests/hour). Upgrade to paid tier for unlimited access.`,
                retryAfter,
                upgradeUrl: "https://api.weblens.dev/docs",
                paidEndpoints: {
                    fetch: "/fetch/basic ($0.005/request)",
                    search: "/search ($0.005/request)",
                },
            },
            429
        );
    }

    // Increment count
    entry.count++;
    const ttl = entry.resetAt - now;

    try {
        await kv.put(kvKey, JSON.stringify(entry), {
            expirationTtl: Math.max(ttl, 60),
        });
    } catch {
        // Non-fatal: allow request even if KV write fails
        console.warn("⚠️ Failed to update rate limit counter");
    }

    // Set rate limit headers
    c.header("X-RateLimit-Limit", String(FREE_TIER.maxRequestsPerHour));
    c.header("X-RateLimit-Remaining", String(FREE_TIER.maxRequestsPerHour - entry.count));
    c.header("X-RateLimit-Reset", String(entry.resetAt));

    // Store remaining count for the handler to use
    c.set("rateLimitRemaining" as never, (FREE_TIER.maxRequestsPerHour - entry.count) as never);

    await next();
}
