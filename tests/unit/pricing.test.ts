
import { describe, it, expect } from 'vitest';
import { PRICING, SEARCH_PROVIDERS } from '../../src/config';
import { calculatePrice, getComplexityMultiplier, usdToMicros } from '../../src/services/pricing';

describe('Pricing Service', () => {
    describe('getComplexityMultiplier', () => {
        it('should return 1.0 for simple root domains', () => {
            expect(getComplexityMultiplier('https://example.com')).toBe(1.0);
            expect(getComplexityMultiplier('https://google.com')).toBe(1.0);
        });

        it('should return higher multiplier for deep paths', () => {
            const url = 'https://example.com/a/b/c/d/e';
            expect(getComplexityMultiplier(url)).toBeGreaterThan(1.0);
        });

        it('should return higher multiplier for complex query params', () => {
            const url = 'https://example.com/search?q=test&filter=1&sort=desc&page=2';
            expect(getComplexityMultiplier(url)).toBeGreaterThan(1.0);
        });

        it('should return max multiplier for known complex domains', () => {
            expect(getComplexityMultiplier('https://twitter.com/user')).toBeGreaterThanOrEqual(2.0);
            expect(getComplexityMultiplier('https://linkedin.com/in/user')).toBeGreaterThanOrEqual(2.0);
        });
    });

    describe('calculatePrice', () => {
        it('should charge the base price for a simple URL', () => {
            const price = calculatePrice('https://example.com', 'fetch-pro');
            expect(parseFloat(price.replace('$', ''))).toBe(parseFloat(PRICING.fetch.pro.replace('$', '')));
        });

        it('should apply complexity multiplier for fetch-pro', () => {
            const complexUrl = 'https://twitter.com/someuser';
            const price = calculatePrice(complexUrl, 'fetch-pro');

            const basePrice = parseFloat(PRICING.fetch.pro.replace('$', ''));
            const calculatedInfo = parseFloat(price.replace('$', ''));

            expect(calculatedInfo).toBeGreaterThan(basePrice);
        });

    });
});

describe('Serper-backed search prices', () => {
    // Serper charges up to serperMaxCreditsPerCall credits for one search WebLens sells (shopping, images,
    // or a second page of results); a price under twice that would leave no room for Workers and settle fees.
    const worstCaseMicros = SEARCH_PROVIDERS.serperCreditUsd * SEARCH_PROVIDERS.serperMaxCreditsPerCall * 1_000_000;
    const { trends: _serpApi, ...serperVerticals } = PRICING.searchVerticals;

    it.each(Object.entries({ search: PRICING.search, ...serperVerticals }))('%s (%s) is at least twice its worst-case Serper cost', (_name, price) => {
        expect(usdToMicros(price)).toBeGreaterThanOrEqual(2 * worstCaseMicros);
    });

    it('trends stays above its SerpAPI cost', () => {
        expect(usdToMicros(PRICING.searchVerticals.trends)).toBeGreaterThan(SEARCH_PROVIDERS.serpApiCallUsd * 1_000_000);
    });
});
