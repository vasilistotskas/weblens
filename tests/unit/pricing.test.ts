
import { describe, it, expect } from 'vitest';
import { PRICING } from '../../src/config';
import { calculatePrice, getComplexityMultiplier } from '../../src/services/pricing';

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
        it('should calculate base price for fetch-basic', async () => {
            const price = await calculatePrice('https://example.com', 'fetch-basic');
            // fetch-basic is usually $0.005. toFixed(4) -> $0.0050
            expect(parseFloat(price.replace('$', ''))).toBe(parseFloat(PRICING.fetch.basic.replace('$', '')));
        });

        it('should apply complexity multiplier for fetch-pro', async () => {
            const complexUrl = 'https://twitter.com/someuser';
            const price = await calculatePrice(complexUrl, 'fetch-pro');

            const basePrice = parseFloat(PRICING.fetch.pro.replace('$', ''));
            const calculatedInfo = parseFloat(price.replace('$', ''));

            expect(calculatedInfo).toBeGreaterThan(basePrice);
        });

        it('should apply discount when provided', async () => {
            const url = 'https://example.com';
            const basePriceStr = await calculatePrice(url, 'fetch-pro', 0);
            const discountedPriceStr = await calculatePrice(url, 'fetch-pro', 0.5); // 50% off

            const base = parseFloat(basePriceStr.replace('$', ''));
            const discounted = parseFloat(discountedPriceStr.replace('$', ''));

            expect(discounted).toBeCloseTo(base * 0.5, 4);
        });
    });
});
