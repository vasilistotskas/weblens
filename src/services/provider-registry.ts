/**
 * Provider Registry — Multi-Provider Smart Routing (Agent Prime)
 *
 * Routes fetch requests through a fallback chain of providers.
 * Tracks success rates per provider and selects the best option.
 * When we proxy through external providers (Firecrawl, Zyte), we add a margin.
 *
 * Architecture:
 *   WebLens native → Firecrawl (x402) → Zyte (x402)
 */

import { PRICING } from "../config";

// ============================================
// Types
// ============================================

export interface ProviderConfig {
    /** Unique provider identifier */
    readonly id: string;
    /** Human-readable name */
    readonly name: string;
    /** Whether this is the native provider (no external x402 call) */
    readonly isNative: boolean;
    /** x402 endpoint URL for external providers */
    readonly x402Endpoint?: string;
    /** Base cost of external provider (used for margin calculation) */
    readonly baseCost?: string;
    /** Provider capabilities */
    readonly capabilities: readonly ("basic" | "javascript" | "anti-bot" | "pdf")[];
    /** Priority order (lower = try first) */
    readonly priority: number;
}

export interface ProviderResult {
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

export interface ResilientFetchResult {
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
        isNative: true,
        capabilities: ["basic"],
        priority: 0,
    },
    {
        id: "firecrawl-x402",
        name: "Firecrawl",
        isNative: false,
        x402Endpoint: "https://api.firecrawl.dev/x402/scrape",
        baseCost: "$0.01",
        capabilities: ["basic", "javascript", "anti-bot"],
        priority: 1,
    },
    {
        id: "zyte-x402",
        name: "Zyte",
        isNative: false,
        x402Endpoint: "https://api.zyte.com/x402/fetch",
        baseCost: "$0.015",
        capabilities: ["basic", "javascript", "anti-bot", "pdf"],
        priority: 2,
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
export async function getProviderStats(
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
export async function recordProviderOutcome(
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
export function getSuccessRate(stats: ProviderStats): number {
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
        // Use the same fetch logic as fetch-basic
        const response = await fetch(url, {
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
 * Attempt to fetch a URL via an external x402 provider.
 * In production, this would make an x402-signed HTTP request to the provider.
 * For now, we implement the interface and log the attempt.
 */
async function fetchViaExternal(
    provider: ProviderConfig,
    url: string,
    timeout: number,
): Promise<ProviderResult> {
    const start = Date.now();

    if (!provider.x402Endpoint) {
        return {
            providerId: provider.id,
            providerName: provider.name,
            success: false,
            latencyMs: Date.now() - start,
            error: "Provider has no x402 endpoint configured",
            isProxied: true,
        };
    }

    try {
        // Make x402 request to external provider
        // The provider expects a POST with {url} and will return the fetched content
        const response = await fetch(provider.x402Endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({ url, timeout }),
            signal: AbortSignal.timeout(timeout + 5000), // Extra buffer for x402 settlement
        });

        // If we get a 402, the external provider requires payment
        // In the future, we'd sign and send an x402 payment here
        if (response.status === 402) {
            return {
                providerId: provider.id,
                providerName: provider.name,
                success: false,
                latencyMs: Date.now() - start,
                error: "External provider requires x402 payment (not yet implemented for this provider)",
                isProxied: true,
            };
        }

        if (!response.ok) {
            return {
                providerId: provider.id,
                providerName: provider.name,
                success: false,
                latencyMs: Date.now() - start,
                error: `External provider returned HTTP ${String(response.status)}`,
                isProxied: true,
            };
        }

        interface ProviderResponse {
            content?: unknown;
            markdown?: unknown;
            title?: unknown;
            description?: unknown;
        }

         
        const data: ProviderResponse = await response.json();

        return {
            providerId: provider.id,
            providerName: provider.name,
            success: true,
            content: typeof data.content === "string" ? data.content : typeof data.markdown === "string" ? data.markdown : "",
            title: typeof data.title === "string" ? data.title : "",
            metadata: {
                description: typeof data.description === "string" ? data.description : undefined,
            },
            latencyMs: Date.now() - start,
            isProxied: true,
        };
    } catch (error) {
        return {
            providerId: provider.id,
            providerName: provider.name,
            success: false,
            latencyMs: Date.now() - start,
            error: error instanceof Error ? error.message : "Unknown error",
            isProxied: true,
        };
    }
}

/**
 * Attempt to fetch a URL using a specific provider.
 */
export async function fetchViaProvider(
    provider: ProviderConfig,
    url: string,
    timeout: number,
): Promise<ProviderResult> {
    if (provider.isNative) {
        return fetchViaNative(url, timeout);
    }
    return fetchViaExternal(provider, url, timeout);
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
        const result = await fetchViaProvider(provider, url, timeout);

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

// ============================================
// Margin Calculation
// ============================================

/**
 * Calculate the effective price for a resilient fetch.
 * If the result was proxied, the price includes the provider margin.
 */
export function calculateResilientPrice(isProxied: boolean): string {
    if (!isProxied) {
        return PRICING.fetch.resilient;
    }

    // For proxied requests, the agent pays the resilient price
    // We internally pay the provider's base cost and keep the margin
    // The agent price is always PRICING.fetch.resilient regardless
    return PRICING.fetch.resilient;
}

/**
 * Calculate our margin when proxying through an external provider.
 * Margin = resilient price - provider base cost
 */
export function calculateProviderMargin(providerBaseCost: string): number {
    const resilientPrice = parseFloat(PRICING.fetch.resilient.replace("$", ""));
    const providerCost = parseFloat(providerBaseCost.replace("$", ""));
    return resilientPrice - providerCost;
}
