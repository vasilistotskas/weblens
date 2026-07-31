/**
 * Provider Registry — Multi-Provider Smart Routing (Agent Prime)
 *
 * Routes fetch requests through a fallback chain of providers.
 * Tracks success rates per provider and selects the best option.
 *
 * Architecture:
 *   WebLens native (plain fetch) → Cloudflare Browser Rendering (headless
 *   Chromium). The browser tier recovers pages the plain fetch cannot get:
 *   client-rendered SPAs, and sites that reject bare HTTP clients but serve
 *   a real browser.
 *
 * History: this chain previously listed Firecrawl and Zyte "via x402", but
 * those calls were never implemented (the code returned "not yet
 * implemented" on 402) and both advertised endpoints 404. The endpoint was
 * therefore charging a premium for plain fetch plus two doomed requests.
 */

import type { Env } from "../types";
import { hardenPage } from "../utils/browser-guard";
import { safeFetch } from "../utils/safe-fetch";

// ============================================
// Types
// ============================================

export interface ProviderConfig {
    /** Unique provider identifier */
    readonly id: string;
    /** Human-readable name */
    readonly name: string;
    /** Transport used to fetch: plain HTTP or headless Chromium. */
    readonly transport: "native" | "browser";
    /** Provider capabilities */
    readonly capabilities: readonly ("basic" | "javascript" | "anti-bot" | "pdf")[];
    /** Priority order (lower = try first) */
    readonly priority: number;
}

interface ProviderResult {
    /** Which provider handled the request */
    providerId: string;
    providerName: string;
    /** Whether the fetch succeeded */
    success: boolean;
    /** Fetched content (if successful) */
    content?: string;
    title?: string;
    metadata?: {
        description?: string;
        author?: string;
        publishedAt?: string;
    };
    /** Time taken in milliseconds */
    latencyMs: number;
    /** Error message if failed */
    error?: string;
    /** Whether the result came from an external provider */
    isProxied: boolean;
}

export interface ProviderStats {
    totalRequests: number;
    successCount: number;
    failureCount: number;
    avgLatencyMs: number;
    lastUpdated: string;
}

interface ResilientFetchResult {
    url: string;
    title: string;
    content: string;
    metadata: {
        description?: string;
        author?: string;
        publishedAt?: string;
    };
    provider: {
        id: string;
        name: string;
        isProxied: boolean;
        attemptsUsed: number;
    };
    tier: "resilient";
    fetchedAt: string;
}

// ============================================
// Provider Definitions
// ============================================

export const PROVIDERS: readonly ProviderConfig[] = [
    {
        id: "weblens-native",
        name: "WebLens Native",
        transport: "native",
        capabilities: ["basic"],
        priority: 0,
    },
    {
        id: "weblens-browser",
        name: "WebLens Browser",
        transport: "browser",
        capabilities: ["basic", "javascript"],
        priority: 1,
    },
] as const;

// ============================================
// Success Rate Tracking
// ============================================

const STATS_KEY_PREFIX = "provider_stats:";
const STATS_TTL_SECONDS = 86400; // 24 hours

/**
 * Get the KV key for a provider's stats
 */
function getStatsKey(providerId: string): string {
    return `${STATS_KEY_PREFIX}${providerId}`;
}

/**
 * Get current stats for a provider. Returns default stats if none exist.
 */
async function getProviderStats(
    kv: KVNamespace | undefined,
    providerId: string,
): Promise<ProviderStats> {
    const defaultStats: ProviderStats = {
        totalRequests: 0,
        successCount: 0,
        failureCount: 0,
        avgLatencyMs: 0,
        lastUpdated: new Date().toISOString(),
    };

    if (!kv) {
        return defaultStats;
    }

    try {
        const data = await kv.get(getStatsKey(providerId));
        if (!data) {
            return defaultStats;
        }
        return JSON.parse(data) as ProviderStats;
    } catch {
        return defaultStats;
    }
}

/**
 * Record the outcome of a fetch attempt for a provider.
 * Updates success rate and average latency.
 */
async function recordProviderOutcome(
    kv: KVNamespace | undefined,
    providerId: string,
    success: boolean,
    latencyMs: number,
): Promise<void> {
    if (!kv) {
        return;
    }

    const stats = await getProviderStats(kv, providerId);

    stats.totalRequests += 1;
    if (success) {
        stats.successCount += 1;
    } else {
        stats.failureCount += 1;
    }

    // Rolling average latency
    if (stats.totalRequests === 1) {
        stats.avgLatencyMs = latencyMs;
    } else {
        stats.avgLatencyMs = Math.round(
            (stats.avgLatencyMs * (stats.totalRequests - 1) + latencyMs) / stats.totalRequests,
        );
    }

    stats.lastUpdated = new Date().toISOString();

    try {
        await kv.put(getStatsKey(providerId), JSON.stringify(stats), {
            expirationTtl: STATS_TTL_SECONDS,
        });
    } catch {
        // Non-critical — don't fail the request over stats
    }
}

/**
 * Get the success rate for a provider (0.0 - 1.0).
 * New providers with no data default to 0.5.
 */
function getSuccessRate(stats: ProviderStats): number {
    if (stats.totalRequests === 0) {
        return 0.5; // Neutral prior for new providers
    }
    return stats.successCount / stats.totalRequests;
}

/**
 * Select providers in priority order, optionally weighted by success rate.
 * Returns a copy sorted by (priority ASC, success rate DESC).
 */
export function selectProviderOrder(
    providers: readonly ProviderConfig[],
    statsMap: Map<string, ProviderStats>,
): ProviderConfig[] {
    return [...providers].sort((a, b) => {
        // Primary sort: priority (lower first)
        if (a.priority !== b.priority) {
            return a.priority - b.priority;
        }
        // Secondary sort: success rate (higher first)
        const aStats = statsMap.get(a.id) ?? { totalRequests: 0, successCount: 0, failureCount: 0, avgLatencyMs: 0, lastUpdated: "" };
        const bStats = statsMap.get(b.id) ?? { totalRequests: 0, successCount: 0, failureCount: 0, avgLatencyMs: 0, lastUpdated: "" };

        const aRate = getSuccessRate(aStats);
        const bRate = getSuccessRate(bStats);



        return bRate - aRate;
    });
}

// ============================================
// Fetch via Provider
// ============================================

/**
 * Attempt to fetch a URL via the native WebLens scraper.
 */
async function fetchViaNative(url: string, timeout: number): Promise<ProviderResult> {
    const start = Date.now();

    try {
        // SSRF-safe: revalidate every redirect hop (blocks redirect-to-internal-IP).
        const response = await safeFetch(url, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
            },
            signal: AbortSignal.timeout(timeout),
        });

        if (!response.ok) {
            return {
                providerId: "weblens-native",
                providerName: "WebLens Native",
                success: false,
                latencyMs: Date.now() - start,
                error: `HTTP ${String(response.status)} ${response.statusText}`,
                isProxied: false,
            };
        }

        // Dynamic import to avoid circular dependencies
        const { htmlToMarkdown, extractMetadata } = await import("../utils/parser");

        const html = await response.text();
        const content = htmlToMarkdown(html);
        const metadata = extractMetadata(html);

        return {
            providerId: "weblens-native",
            providerName: "WebLens Native",
            success: true,
            content,
            title: metadata.title ?? "",
            metadata: {
                description: metadata.description,
                author: metadata.author,
                publishedAt: metadata.publishedAt,
            },
            latencyMs: Date.now() - start,
            isProxied: false,
        };
    } catch (error) {
        return {
            providerId: "weblens-native",
            providerName: "WebLens Native",
            success: false,
            latencyMs: Date.now() - start,
            error: error instanceof Error ? error.message : "Unknown error",
            isProxied: false,
        };
    }
}

/**
 * Attempt to fetch a URL via Cloudflare Browser Rendering (headless
 * Chromium). Recovers client-rendered pages and sites that refuse bare HTTP
 * clients. `hardenPage` re-validates every request the page makes, so
 * redirects and subresources cannot reach internal addresses.
 */
async function fetchViaBrowser(
    url: string,
    timeout: number,
    browser: Fetcher | undefined,
): Promise<ProviderResult> {
    const start = Date.now();

    if (!browser) {
        return {
            providerId: "weblens-browser",
            providerName: "WebLens Browser",
            success: false,
            latencyMs: Date.now() - start,
            error: "Browser rendering is not available",
            isProxied: false,
        };
    }

    const puppeteer = (await import("@cloudflare/puppeteer")).default;
    const instance = await puppeteer.launch(browser);
    try {
        const page = await instance.newPage();
        await hardenPage(page);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout });

        const html = await page.content();
        const pageTitle = await page.title();

        const { htmlToMarkdown, extractMetadata } = await import("../utils/parser");
        const metadata = extractMetadata(html);

        return {
            providerId: "weblens-browser",
            providerName: "WebLens Browser",
            success: true,
            content: htmlToMarkdown(html),
            title: pageTitle !== "" ? pageTitle : metadata.title ?? "",
            metadata: {
                description: metadata.description,
                author: metadata.author,
                publishedAt: metadata.publishedAt,
            },
            latencyMs: Date.now() - start,
            isProxied: false,
        };
    } catch (error) {
        return {
            providerId: "weblens-browser",
            providerName: "WebLens Browser",
            success: false,
            latencyMs: Date.now() - start,
            error: error instanceof Error ? error.message : "Unknown error",
            isProxied: false,
        };
    } finally {
        await instance.close();
    }
}

/**
 * Attempt to fetch a URL using a specific provider.
 */
async function fetchViaProvider(
    provider: ProviderConfig,
    url: string,
    timeout: number,
    env: Env | undefined,
): Promise<ProviderResult> {
    if (provider.transport === "native") {
        return fetchViaNative(url, timeout);
    }
    return fetchViaBrowser(url, timeout, env?.BROWSER);
}

// ============================================
// Resilient Fetch Orchestrator
// ============================================

/**
 * Fetch a URL with automatic fallback through the provider chain.
 * Tries each provider in priority order until one succeeds.
 * Records outcomes for success rate tracking.
 */
export async function resilientFetch(
    url: string,
    timeout: number,
    kv: KVNamespace | undefined,
    env?: Env,
): Promise<ResilientFetchResult> {
    // Get stats for each provider
    const statsMap = new Map<string, ProviderStats>();
    for (const provider of PROVIDERS) {
        const stats = await getProviderStats(kv, provider.id);
        statsMap.set(provider.id, stats);
    }

    // Determine provider order
    const ordered = selectProviderOrder(PROVIDERS, statsMap);

    const errors: string[] = [];
    let attempts = 0;

    for (const provider of ordered) {
        attempts++;
        const result = await fetchViaProvider(provider, url, timeout, env);

        // Record outcome for stats tracking
        void recordProviderOutcome(kv, provider.id, result.success, result.latencyMs);

        if (result.success) {
            return {
                url,
                title: result.title ?? "",
                content: result.content ?? "",
                metadata: result.metadata ?? {},
                provider: {
                    id: result.providerId,
                    name: result.providerName,
                    isProxied: result.isProxied,
                    attemptsUsed: attempts,
                },
                tier: "resilient",
                fetchedAt: new Date().toISOString(),
            };
        }

        errors.push(`${provider.name}: ${result.error ?? "unknown"}`);
    }

    // All providers failed
    throw new Error(
        `All ${String(ordered.length)} providers failed for ${url}: ${errors.join("; ")}`,
    );
}
