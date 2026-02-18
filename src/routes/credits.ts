import type { Hono } from "hono";
import { createLazyPaymentMiddleware } from "../middleware/payment";
import { validateRequest } from "../middleware/validation";
import { CreditsBuyRequestSchema } from "../schemas";

// Tool Handlers
import { buyCreditsHandler, getBalanceHandler, getHistoryHandler } from "../tools/credits";
import type { Env, Variables } from "../types";

export function registerCreditsRoutes(app: Hono<{ Bindings: Env; Variables: Variables }>) {

    // ============================================
    // /credits/buy
    // ============================================
    app.use(
        "/credits/buy",
        validateRequest(CreditsBuyRequestSchema),
        createLazyPaymentMiddleware(
            "/credits/buy",
            async (c) => {
                const body: { amount?: number } = await c.req.json();
                const amount = body.amount ?? 5;
                return `$${amount.toFixed(2)}`;
            },
            "Buy prepaid credits for WebLens API. Credits are used for all paid endpoints and offer a 10% bonus for purchases over $50.",
            { amount: 10 },
            {
                properties: {
                    amount: { type: "number", description: "Amount in USD to purchase (min $5)" },
                },
                required: ["amount"],
            },
            {
                success: true,
                newBalance: 15.00,
                addedCredits: 10.00,
                bonus: 0,
                transactionId: "tx_123",
                requestId: "req_credits456",
            },
            {
                properties: {
                    success: { type: "boolean" },
                    newBalance: { type: "number" },
                    addedCredits: { type: "number" },
                    bonus: { type: "number" },
                    transactionId: { type: "string" },
                    requestId: { type: "string" },
                },
            }
        )
    );
    app.post("/credits/buy", buyCreditsHandler);

    // ============================================
    // /credits/balance - Authenticated by Wallet Signature
    // ============================================
    app.get("/credits/balance", getBalanceHandler);

    // ============================================
    // /credits/history - Authenticated by Wallet Signature
    // ============================================
    app.get("/credits/history", getHistoryHandler);
}
