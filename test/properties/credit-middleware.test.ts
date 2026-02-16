import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { createCreditMiddleware } from "../../src/middleware/credit-middleware";
import { deductCredits } from "../../src/services/credits";
import { verifyWalletSignature } from "../../src/utils/security";
import { Context, Next } from "hono";
import { Env } from "../../src/types";
import { CreditAccount } from "../../src/services/credits";

// Mock the credits service
vi.mock("../../src/services/credits", () => ({
    deductCredits: vi.fn(),
}));

// Mock security utility
vi.mock("../../src/utils/security", () => ({
    verifyWalletSignature: vi.fn(),
}));

interface IMockContext extends Context<{ Bindings: Env }> {
    req: {
        header: Mock<(name: string) => string | undefined>;
    } & Context<{ Bindings: Env }>["req"];
}

describe("Credit Middleware", () => {
    let mockContext: IMockContext;
    let mockNext: Next;

    beforeEach(() => {
        vi.resetAllMocks();
        mockContext = {
            req: {
                header: vi.fn() as unknown as (name: string) => string | undefined,
            },
            env: {
                CREDITS: {
                    get: vi.fn(),
                    put: vi.fn(),
                    delete: vi.fn(),
                    list: vi.fn(),
                } as unknown as KVNamespace,
            },
            get: vi.fn(),
            set: vi.fn(),
            json: vi.fn(),
        } as unknown as IMockContext;
        mockNext = vi.fn() as unknown as Next;
    });

    it("should proceed to next middleware if X-CREDIT-WALLET header is missing", async () => {
        mockContext.req.header.mockReturnValue(undefined); // No header

        const middleware = createCreditMiddleware("$0.01", "Test Charge");
        await middleware(mockContext, mockNext);

        expect(mockNext).toHaveBeenCalled();
        expect(deductCredits).not.toHaveBeenCalled();
    });

    it("should return 401 if signature verification fails", async () => {
        mockContext.req.header.mockImplementation((name: string) => {
            if (name === "X-CREDIT-WALLET") { return "0x123"; }
            if (name === "X-CREDIT-SIGNATURE") { return "0xSig"; }
            if (name === "X-CREDIT-TIMESTAMP") { return Date.now().toString(); }
            return undefined;
        });

        vi.mocked(verifyWalletSignature).mockResolvedValue({ isValid: false, error: "Invalid signature" });

        const middleware = createCreditMiddleware("$0.01", "Test Charge");
        await middleware(mockContext, mockNext);

        expect(mockContext.json).toHaveBeenCalledWith(
            expect.objectContaining({ error: "AUTH_FAILED" }),
            401
        );
        expect(mockNext).not.toHaveBeenCalled();
        expect(deductCredits).not.toHaveBeenCalled();
    });

    it("should proceed and debit credits if valid headers are present", async () => {
        mockContext.req.header.mockImplementation((name: string) => {
            if (name === "X-CREDIT-WALLET") { return "0x123"; }
            if (name === "X-CREDIT-SIGNATURE") { return "0xSig"; }
            if (name === "X-CREDIT-TIMESTAMP") { return Date.now().toString(); }
            return undefined;
        });

        vi.mocked(verifyWalletSignature).mockResolvedValue({ isValid: true });
        vi.mocked(deductCredits).mockResolvedValue({
            walletAddress: "0x123",
            balance: 10,
            totalDeposited: 10,
            totalSpent: 0,
            createdAt: new Date().toISOString(),
            lastActivityAt: new Date().toISOString(),
            tier: "standard"
        } as CreditAccount);

        const middleware = createCreditMiddleware("$0.01", "Test Charge");
        await middleware(mockContext, mockNext);

        expect(deductCredits).toHaveBeenCalled();
        expect(mockNext).toHaveBeenCalled();
        expect(mockContext.set).toHaveBeenCalledWith("paidWithCredits", true);
    });

    it("should allow next() on debit failure (fallthrough to x402)", async () => {
        mockContext.req.header.mockImplementation((name: string) => {
            if (name === "X-CREDIT-WALLET") { return "0x123"; }
            if (name === "X-CREDIT-SIGNATURE") { return "0xSig"; }
            if (name === "X-CREDIT-TIMESTAMP") { return Date.now().toString(); }
            return undefined;
        });

        vi.mocked(verifyWalletSignature).mockResolvedValue({ isValid: true });
        vi.mocked(deductCredits).mockRejectedValue(new Error("Insufficient funds"));

        const middleware = createCreditMiddleware("$0.01", "Test Charge");
        await middleware(mockContext, mockNext);

        expect(deductCredits).toHaveBeenCalled();
        expect(mockNext).toHaveBeenCalled(); // Should proceed to x402
        expect(mockContext.set).not.toHaveBeenCalledWith("paidWithCredits", true);
    });
});
