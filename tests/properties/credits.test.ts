import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    getCreditAccount,
    processDeposit,
    deductCredits,
    CreditAccount
} from "../../src/services/credits";

// Mock Cloudflare Durable Object Namespace types
// Since we don't have the types at runtime in Node, we use any/unknown
type DOStub = {
    fetch: ReturnType<typeof vi.fn>;
    id: { toString: () => string };
};

type DONamespace = {
    idFromName: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
};

describe("Agent Credit Accounts Service", () => {
    let mockStub: DOStub;
    let mockNamespace: DONamespace;

    beforeEach(() => {
        vi.restoreAllMocks();

        // Setup Stub mock
        mockStub = {
            fetch: vi.fn(),
            id: { toString: () => "mock-id" },
        };

        // Setup Namespace mock
        mockNamespace = {
            idFromName: vi.fn().mockImplementation((name) => `id-${name}`),
            get: vi.fn().mockReturnValue(mockStub),
        };
    });

    describe("getCreditAccount", () => {
        it("should fetch account from DO", async () => {
            const mockAccount: CreditAccount = {
                walletAddress: "0x123",
                balance: 50.00,
                totalDeposited: 40.00,
                totalSpent: 0,
                tier: "gold",
                createdAt: new Date().toISOString(),
                lastActivityAt: new Date().toISOString(),
            };

            // Mock fetch response
            mockStub.fetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => mockAccount,
            } as any);

            const account = await getCreditAccount(mockNamespace as any, "0x123");

            expect(account).toEqual(mockAccount);
            expect(mockNamespace.idFromName).toHaveBeenCalledWith("0x123"); // or lowercase
            expect(mockStub.fetch).toHaveBeenCalledWith("http://do/balance");
        });

        it("should return null if DO returns 404", async () => {
            mockStub.fetch.mockResolvedValue({
                ok: false,
                status: 404,
            } as any);

            const account = await getCreditAccount(mockNamespace as any, "0xNew");
            expect(account).toBeNull();
        });
    });

    describe("processDeposit", () => {
        it("should calculate correct bonus and call DO deposit", async () => {
            // Mock initial fetch response (from deposit call)
            mockStub.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true }),
            } as any);

            // Mock subsequent getCreditAccount call
            const updatedAccount: CreditAccount = {
                walletAddress: "0xTest",
                balance: 12.00,
                totalDeposited: 10.00,
                totalSpent: 0,
                tier: "standard",
                createdAt: "",
                lastActivityAt: "",
            };
            mockStub.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => updatedAccount,
            } as any);

            // $10 deposit -> 20% bonus ($2) -> $12 total
            const result = await processDeposit(mockNamespace as any, "0xTest", 10.00, "txn_1");

            expect(result.account.balance).toBe(12.00);
            expect(result.bonusAccrued).toBe(2.00);

            // Verify DO call payload
            expect(mockStub.fetch).toHaveBeenNthCalledWith(1, "http://do/deposit", expect.objectContaining({
                method: "POST",
                body: expect.stringContaining('"amount":12'), // 10 + 2
            }));
            // Verify metadata
            expect(mockStub.fetch).toHaveBeenCalledWith("http://do/deposit", expect.objectContaining({
                body: expect.stringContaining('"bonus":2'),
            }));
        });
    });

    describe("deductCredits", () => {
        it("should call DO spend endpoint", async () => {
            // Mock spend call
            mockStub.fetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ success: true }),
            } as any);

            // Mock getCreditAccount call
            const mockAccount = { balance: 9.00 } as CreditAccount;
            mockStub.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockAccount,
            } as any);

            const account = await deductCredits(mockNamespace as any, "0xRich", 1.00, "Usage", "req_1");

            expect(account.balance).toBe(9.00);
            expect(mockStub.fetch).toHaveBeenCalledWith("http://do/spend", expect.objectContaining({
                method: "POST",
                body: expect.stringContaining('"amount":1'),
            }));
        });

        it("should throw if DO returns 402", async () => {
            mockStub.fetch.mockResolvedValue({
                ok: false,
                status: 402,
                json: async () => ({ error: "Insufficient credits" }),
            } as any);

            await expect(deductCredits(mockNamespace as any, "0xPoor", 1.00, "Usage", "req_2"))
                .rejects.toThrow("Insufficient credits");
        });
    });
});
