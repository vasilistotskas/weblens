import type { WalletProvider } from '@coinbase/agentkit';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebLensActionProvider } from '../../src/skills/WebLensActionProvider';

// Mock X402ActionProvider
vi.mock('@coinbase/agentkit', async (importOriginal) => {
    const actual: Record<string, unknown> = await importOriginal();
    const MockX402 = vi.fn() as ReturnType<typeof vi.fn> & { prototype: Record<string, ReturnType<typeof vi.fn>> };
    MockX402.prototype.supportsNetwork = vi.fn().mockReturnValue(true);
    MockX402.prototype.makeHttpRequestWithX402 = vi.fn().mockResolvedValue(JSON.stringify({ success: true, data: "mock-response" }));

    return {
        ...actual,
        X402ActionProvider: MockX402,
    };
});

describe('WebLensActionProvider', () => {
    let provider: WebLensActionProvider;
    let mockWallet: WalletProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        provider = new WebLensActionProvider();
        mockWallet = {} as WalletProvider;
    });

    it('should implement ActionProvider interface', () => {
        expect(provider).toBeDefined();
        expect(provider.getActions(mockWallet)).toHaveLength(5);
    });

    it('should support networks supported by x402', () => {
        expect(provider.supportsNetwork({ protocolFamily: "evm", networkId: "base-sepolia" })).toBe(true);
    });

    describe('fetchPageAction', () => {
        it('should call makeHttpRequestWithX402 with correct parameters', async () => {
            const actions = provider.getActions(mockWallet);
            const fetchAction = actions.find(a => a.name === 'weblens_fetch_page');
            expect(fetchAction).toBeDefined();

            const args = { url: 'https://example.com', includeLinks: true };
            if (!fetchAction) { throw new Error("fetchAction not found"); }
            await fetchAction.invoke(args);

            // Access the mocked instance
            // @ts-expect-error - accessing private property for test
            const x402Mock = provider.x402Provider as { makeHttpRequestWithX402: ReturnType<typeof vi.fn> };

            expect(x402Mock.makeHttpRequestWithX402).toHaveBeenCalledWith(
                mockWallet,
                expect.objectContaining({
                    url: 'https://api.weblens.dev/fetch/basic',
                    method: 'POST',
                    body: { url: 'https://example.com', includeLinks: true },
                })
            );
        });
    });

    describe('getWeatherAction', () => {
        it('should call makeHttpRequestWithX402 with correct parameters', async () => {
            const actions = provider.getActions(mockWallet);
            const weatherAction = actions.find(a => a.name === 'weblens_get_weather');
            expect(weatherAction).toBeDefined();

            if (!weatherAction) { throw new Error("weatherAction not found"); }
            await weatherAction.invoke({ location: 'London' });

            // @ts-expect-error - accessing private property for test
            const x402Mock = provider.x402Provider as { makeHttpRequestWithX402: ReturnType<typeof vi.fn> };

            expect(x402Mock.makeHttpRequestWithX402).toHaveBeenCalledWith(
                mockWallet,
                expect.objectContaining({
                    url: 'https://api.weblens.dev/search',
                    body: { query: 'current weather in London', limit: 1 },
                })
            );
        });
    });
});
