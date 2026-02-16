/**
 * Tests for Resilient Fetch (Agent Prime)
 */

import { describe, it, expect } from "vitest";
import {
    selectProviderOrder,
    calculateResilientPrice,
    calculateProviderMargin,
    type ProviderConfig,
    type ProviderStats,
    PROVIDERS,
} from "../../src/services/provider-registry";
import { PRICING } from "../../src/config";

describe("Provider selection logic", () => {
    it("always prioritizes lower priority value providers", () => {
        const mockStats = new Map<string, ProviderStats>();
        // Stats don't matter for this test as priority differs
        PROVIDERS.forEach(p => {
            mockStats.set(p.id, {
                totalRequests: 100,
                successCount: 50,
                failureCount: 50,
                avgLatencyMs: 100,
                lastUpdated: new Date().toISOString(),
            });
        });

        const ordered = selectProviderOrder(PROVIDERS, mockStats);

        expect(ordered[0].id).toBe("weblens-native");
        expect(ordered[0].priority).toBe(0);

        expect(ordered[1].id).toBe("firecrawl-x402");
        expect(ordered[1].priority).toBe(1);

        expect(ordered[2].id).toBe("zyte-x402");
        expect(ordered[2].priority).toBe(2);
    });

    it("sorts by success rate descending when priorities are equal", () => {
        const mockProviders: ProviderConfig[] = [
            {
                id: "p1",
                name: "P1",
                isNative: false,
                capabilities: ["basic"],
                priority: 1,
            },
            {
                id: "p2",
                name: "P2",
                isNative: false,
                capabilities: ["basic"],
                priority: 1,
            },
        ];

        const stats = new Map<string, ProviderStats>();

        // P1: 10% success
        stats.set("p1", {
            totalRequests: 100,
            successCount: 10,  // 10%
            failureCount: 90,
            avgLatencyMs: 100,
            lastUpdated: "",
        });

        // P2: 90% success
        stats.set("p2", {
            totalRequests: 100,
            successCount: 90,  // 90%
            failureCount: 10,
            avgLatencyMs: 100,
            lastUpdated: "",
        });

        const ordered = selectProviderOrder(mockProviders, stats);

        // Debug output
        console.log("Ordered IDs:", ordered.map(p => p.id));

        // P2 should be first
        expect(ordered[0].id).toBe("p2");
        expect(ordered[1].id).toBe("p1");
    });
});

describe("Margin calculations", () => {
    it("agent price matches configuration regardless of proxy status", () => {
        expect(calculateResilientPrice(true)).toBe(PRICING.fetch.resilient);
        expect(calculateResilientPrice(false)).toBe(PRICING.fetch.resilient);
    });

    it("margin is positive for all external providers", () => {
        const externalProviders = PROVIDERS.filter((p) => !p.isNative);

        externalProviders.forEach((p) => {
            if (p.baseCost) {
                const margin = calculateProviderMargin(p.baseCost);
                expect(margin).toBeGreaterThan(0);
                expect(margin).toBeLessThan(0.025);
            }
        });
    });
});
