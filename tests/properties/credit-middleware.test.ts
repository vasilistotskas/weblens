import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { createCreditMiddleware } from "../../src/middleware/credit-middleware";
import { deductCredits, refundCredits } from "../../src/services/credits";
import { verifyWalletSignature } from "../../src/utils/security";
import { Context, Next } from "hono";
import { Env } from "../../src/types";
import { CreditAccount } from "../../src/services/credits";

// Mock the credits service
vi.mock("../../src/services/credits", () => ({
    deductCredits: vi.fn(),
    refundCredits: vi.fn(),
}));

// Mock security utility
vi.mock("../../src/utils/security", () => ({
    verifyWalletSignature: vi.fn(),
}));

interface IMockContext extends Context<{ Bindings: Env }> {
    req: {
        header: Mock<(name: string) => string | undefined>;
    } & Context<{ Bindings: Env }>["req"];
    res: { status: number };
}

const REQUEST_ID = "wl_test_req1";

function setValidCreditHeaders(ctx: IMockContext) {
    ctx.req.header.mockImplementation((name: string) => {
        if (name === "X-CREDIT-WALLET") { return "0x123"; }
        if (name === "X-CREDIT-SIGNATURE") { return "0xSig"; }
        if (name === "X-CREDIT-TIMESTAMP") { return Date.now().toString(); }
        return undefined;
    });
}

function mockSuccessfulDebit() {
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
}

describe("Credit Middleware", () => {
    let mockContext: IMockContext;
    let mockNext: Next;

    beforeEach(() => {
        vi.resetAllMocks();
        // No-op structured logger, as the global requestId middleware would set.
        const noopLogger = {
            debug() {}, info() {}, warn() {}, error() {},
            child() { return noopLogger; },
        };
        mockContext = {
            req: {
                header: vi.fn() as unknown as (name: string) => string | undefined,
            },
            env: {
                CREDIT_MANAGER: {
                    idFromName: vi.fn(),
                    get: vi.fn(),
                } as unknown as any,
            },
            get: vi.fn((key: string) => {
                if (key === "log") { return noopLogger; }
                if (key === "requestId") { return REQUEST_ID; }
                return undefined;
            }),
            set: vi.fn(),
            json: vi.fn(),
            header: vi.fn(),
            // The middleware inspects the final response status after next()
            // to decide whether to refund. Default to a 200 success.
            res: { status: 200 },
        } as unknown as IMockContext;
        // next() resolves with the (default 200) response in place.
        mockNext = vi.fn(() => Promise.resolve()) as unknown as Next;
    });

    it("should proceed to next middleware if X-CREDIT-WALLET header is missing", async () => {
        mockContext.req.header.mockReturnValue(undefined); // No header

        const middleware = createCreditMiddleware("$0.01", "Test Charge");
        await middleware(mockContext, mockNext);

        expect(mockNext).toHaveBeenCalled();
        expect(deductCredits).not.toHaveBeenCalled();
    });

    it("should return 401 if signature verification fails", async () => {
        setValidCreditHeaders(mockContext);

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
        setValidCreditHeaders(mockContext);
        mockSuccessfulDebit();

        const middleware = createCreditMiddleware("$0.01", "Test Charge");
        await middleware(mockContext, mockNext);

        expect(deductCredits).toHaveBeenCalled();
        expect(mockNext).toHaveBeenCalled();
        expect(mockContext.set).toHaveBeenCalledWith("paidWithCredits", true);
    });

    it("should support async cost functions", async () => {
        setValidCreditHeaders(mockContext);
        mockSuccessfulDebit();

        const middleware = createCreditMiddleware(
            () => Promise.resolve("$0.02"),
            "Dynamic Charge",
        );
        await middleware(mockContext, mockNext);

        expect(deductCredits).toHaveBeenCalledWith(
            mockContext.env.CREDIT_MANAGER,
            "0x123",
            0.02,
            "Dynamic Charge",
            REQUEST_ID,
        );
        expect(mockContext.header).toHaveBeenCalledWith("Credit-Cost", "$0.02");
    });

    it("should allow next() on debit failure (fallthrough to x402)", async () => {
        setValidCreditHeaders(mockContext);

        vi.mocked(verifyWalletSignature).mockResolvedValue({ isValid: true });
        vi.mocked(deductCredits).mockRejectedValue(new Error("Insufficient funds"));

        const middleware = createCreditMiddleware("$0.01", "Test Charge");
        await middleware(mockContext, mockNext);

        expect(deductCredits).toHaveBeenCalled();
        expect(mockNext).toHaveBeenCalled(); // Should proceed to x402
        expect(mockContext.set).not.toHaveBeenCalledWith("paidWithCredits", true);
    });

    it("refunds the debit when next() resolves with an error status (502)", async () => {
        setValidCreditHeaders(mockContext);
        mockSuccessfulDebit();
        vi.mocked(refundCredits).mockResolvedValue(undefined);

        // Handler catches its own error and *returns* a 502 envelope.
        mockNext = vi.fn(() => {
            mockContext.res.status = 502;
            return Promise.resolve();
        }) as unknown as Next;

        const middleware = createCreditMiddleware("$0.01", "Test Charge");
        await middleware(mockContext, mockNext);

        expect(refundCredits).toHaveBeenCalledTimes(1);
        expect(refundCredits).toHaveBeenCalledWith(
            mockContext.env.CREDIT_MANAGER,
            "0x123",
            0.01,
            expect.any(String),
            `refund:${REQUEST_ID}`, // idempotency key
        );
        expect(mockContext.header).toHaveBeenCalledWith("Payment-Method", "Credits");
        expect(mockContext.header).toHaveBeenCalledWith("Credit-Refunded", "$0.01");
        expect(mockContext.header).not.toHaveBeenCalledWith("Credit-Cost", expect.anything());
    });

    it("does not refund on success (200) and sets Credit-Cost", async () => {
        setValidCreditHeaders(mockContext);
        mockSuccessfulDebit();

        const middleware = createCreditMiddleware("$0.01", "Test Charge");
        await middleware(mockContext, mockNext);

        expect(refundCredits).not.toHaveBeenCalled();
        expect(mockContext.header).toHaveBeenCalledWith("Payment-Method", "Credits");
        expect(mockContext.header).toHaveBeenCalledWith("Credit-Cost", "$0.01");
        expect(mockContext.header).not.toHaveBeenCalledWith("Credit-Refunded", expect.anything());
    });

    it("refunds and rethrows when next() throws after a successful debit", async () => {
        setValidCreditHeaders(mockContext);
        mockSuccessfulDebit();
        vi.mocked(refundCredits).mockResolvedValue(undefined);

        mockNext = vi.fn(() => Promise.reject(new Error("handler exploded"))) as unknown as Next;

        const middleware = createCreditMiddleware("$0.01", "Test Charge");
        await expect(middleware(mockContext, mockNext)).rejects.toThrow("handler exploded");

        expect(refundCredits).toHaveBeenCalledTimes(1);
        expect(refundCredits).toHaveBeenCalledWith(
            mockContext.env.CREDIT_MANAGER,
            "0x123",
            0.01,
            expect.any(String),
            `refund:${REQUEST_ID}`,
        );
    });
});
