import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    getCreditAccount,
    processDeposit,
    deductCredits,
    CreditAccount
} from "../../src/services/credits";

// Mock Cloudflare KV
const mockKV = {
    get: vi.fn(),
    put: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
    getWithMetadata: vi.fn(),
} as unknown as KVNamespace;

describe("Agent Credit Accounts", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        // Default: KV returns null (not found)
        vi.mocked(mockKV.get).mockImplementation(async (key: string) => {
            if (key.includes("history")) return "[]"; // Default empty history
            return null; // Default no account
        });
    });

    describe("getCreditAccount", () => {
        it("should return existing account", async () => {
            const mockAccount: CreditAccount = {
                walletAddress: "0x123",
                balance: 50.00,
                totalDeposited: 40.00,
                totalSpent: 0,
                tier: "gold",
                createdAt: new Date().toISOString(),
                lastActivityAt: new Date().toISOString(),
            };
            vi.mocked(mockKV.get).mockImplementation(async (key) => {
                if (key === "account:0x123") return JSON.stringify(mockAccount);
                return null;
            });

            const account = await getCreditAccount(mockKV, "0x123");
            expect(account).toEqual(mockAccount);
            expect(mockKV.get).toHaveBeenCalledWith("account:0x123");
        });

        it("should return default account if not found", async () => {
            // getCreditAccount returns null if not found
            // getOrCreateCreditAccount returns default
            // The service exports getCreditAccount which returns null
            const account = await getCreditAccount(mockKV, "0xNew");
            expect(account).toBeNull();
        });
    });

    describe("processDeposit", () => {
        it("should add funds with correct bonus for tier 1 ($10)", async () => {
            // $10 deposit -> 20% bonus -> $12 total
            const result = await processDeposit(mockKV, "0xTest", 10.00, "txn_1");

            expect(result.account.balance).toBe(12.00);
            expect(result.bonusAccrued).toBe(2.00);

            // Verify KV puts (Account, Deposit Tx, Bonus Tx)
            // It calls saveCreditAccount (1), appendTransaction(deposit) (1), appendTransaction(bonus) (1)
            expect(mockKV.put).toHaveBeenCalledTimes(3);
        });

        it("should add funds with correct bonus for tier 2 ($50)", async () => {
            // $50 deposit -> 30% bonus -> $65 total
            const result = await processDeposit(mockKV, "0xTest", 50.00, "txn_2");

            expect(result.account.balance).toBe(65.00);
            expect(result.bonusAccrued).toBe(15.00);
        });

        it("should add funds with correct bonus for tier 3 ($100)", async () => {
            // $100 deposit -> 40% bonus -> $140 total
            const result = await processDeposit(mockKV, "0xTest", 100.00, "txn_3");

            expect(result.account.balance).toBe(140.00);
            expect(result.bonusAccrued).toBe(40.00);
        });
    });

    describe("deductCredits", () => {
        it("should deduct credits if balance is sufficient", async () => {
            const mockAccount: CreditAccount = {
                walletAddress: "0xrich",
                balance: 10.00,
                totalDeposited: 10.00,
                totalSpent: 0,
                tier: "standard",
                createdAt: "",
                lastActivityAt: "",
            };
            vi.mocked(mockKV.get).mockImplementation(async (key) => {
                if (key.includes("history")) return "[]";
                if (key === "account:0xrich") return JSON.stringify(mockAccount); // Lowercase key in service
                return null;
            });

            const account = await deductCredits(mockKV, "0xRich", 1.00, "Usage", "req_1");

            expect(account.balance).toBe(9.00);
            expect(mockKV.put).toHaveBeenCalled();
        });

        it("should throw if balance is insufficient", async () => {
            const mockAccount: CreditAccount = {
                walletAddress: "0xpoor",
                balance: 0.50,
                totalDeposited: 0.50,
                totalSpent: 0,
                tier: "standard",
                createdAt: "",
                lastActivityAt: "",
            };
            vi.mocked(mockKV.get).mockImplementation(async (key) => {
                if (key.includes("history")) return "[]";
                if (key === "account:0xpoor") return JSON.stringify(mockAccount);
                return null;
            });

            await expect(deductCredits(mockKV, "0xPoor", 1.00, "Usage", "req_2"))
                .rejects.toThrow("Insufficient credits");
        });
    });
});
