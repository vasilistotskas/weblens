
import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock the scheduler preventing "cloudflare:workers" import error
vi.mock('../../src/services/scheduler', () => ({
    MonitorScheduler: class { }
}));

// Set required env vars
process.env.PAY_TO_ADDRESS = "0x1234567890123456789012345678901234567890";
process.env.CDP_API_KEY_ID = "test-id";
process.env.CDP_API_KEY_SECRET = "test-secret";

let app: any;

beforeAll(async () => {
    const module = await import('../../src/index');
    app = module.default;
});

// Mock the dependencies that cause side effects or require network
vi.mock('@x402/hono', () => {
    return {
        paymentMiddleware: () => async (c: any, next: any) => {
            // Mock middleware: if no payment header, return 402
            if (!c.req.header('X-Payment')) {
                return c.json({ error: 'Payment Required', price: '$0.005' }, 402);
            }
            return next();
        },
        x402ResourceServer: class {
            static init() { return new this(); }
            register() { }
            registerExtension() { }
        },
        HTTPFacilitatorClient: class { },
        ExactEvmScheme: class { },
        createFacilitatorConfig: () => ({}),
        declareDiscoveryExtension: () => ({})
    };
});

// Mock credit middleware to avoid credit checks
vi.mock('../../src/tools/credits', () => {
    return {
        createCreditMiddleware: () => async (c: any, next: any) => await next(),
        buyCreditsHandler: async () => { },
        getBalanceHandler: async () => { },
        getHistoryHandler: async () => { }
    };
});

describe('Payment Flow Integration', () => {
    it('should return 402 Payment Required for /fetch/pro without payment', async () => {
        const res = await app.request('/fetch/pro', {
            method: 'POST',
            body: JSON.stringify({ url: 'https://example.com' }),
            headers: { 'Content-Type': 'application/json' }
        }, {
            NETWORK: "base-sepolia",
            CDP_API_KEY_ID: "test",
            CDP_API_KEY_SECRET: "test",
            PAY_TO_ADDRESS: "0x123",
            CREDIT_MANAGER: {} // Mock DO namespace
        });

        if (res.status !== 402) {
            const text = await res.text();
            expect(`${res.status}: ${text}`).toBe("402: Payment Required");
        }
        expect(res.status).toBe(402);
        if (res.status === 402) {
            const body = await res.json();
            expect(body.error).toBe('Payment Required');
        }
    });

    it('should fail with 402 for /extract without payment', async () => {
        const res = await app.request('/extract', {
            method: 'POST',
            body: JSON.stringify({ url: 'https://example.com', schema: { foo: 'string' } }),
            headers: { 'Content-Type': 'application/json' }
        }, {
            NETWORK: "base-sepolia",
            CDP_API_KEY_ID: "test",
            CDP_API_KEY_SECRET: "test",
            PAY_TO_ADDRESS: "0x123",
            CREDIT_MANAGER: {} // Mock DO namespace
        });

        expect(res.status).toBe(402);
    });

    // Note: We cannot easily test successful payment without a valid signature + real facilitator verification
    // which is outside the scope of unit/integration testing without specific testnet keys.
});
