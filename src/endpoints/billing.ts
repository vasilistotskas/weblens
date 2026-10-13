/**
 * Billing endpoints: buying prepaid credit.
 */

import { CREDIT_PURCHASE_USD } from "../config";
import { CreditsBuyRequestSchema } from "../schemas";
import { defineEndpoint } from "./define";

export const BILLING_ENDPOINTS = [
    defineEndpoint({
        path: "/credits/buy",
        title: "Buy Credits",
        description: "Buy prepaid credits for WebLens API. Credits are used for all paid endpoints and offer bonuses at $10/$50/$100 tiers.",
        catalogTags: ["billing", "credits"],
        input: CreditsBuyRequestSchema,
        inputExample: { amount: 10 },
        outputExample: {
            success: true,
            newBalance: 15.00,
            addedCredits: 10.00,
            bonus: 0,
            transactionId: "tx_123",
            requestId: "req_credits456",
        },
        outputSchema: {
            properties: {
                success: { type: "boolean" },
                newBalance: { type: "number" },
                addedCredits: { type: "number" },
                bonus: { type: "number" },
                transactionId: { type: "string" },
                requestId: { type: "string" },
            },
        },
        // The buyer names the amount; the price is that amount.
        price: {
            resolve: (body) => `$${(body?.amount ?? CREDIT_PURCHASE_USD.min).toFixed(2)}`,
            min: CREDIT_PURCHASE_USD.min,
            max: CREDIT_PURCHASE_USD.max,
        },
        // Credits cannot buy credits.
        acceptsCredits: false,
        // The handler credits the payer it reads from the EIP-3009
        // authorization.from, and credit accounts are EVM wallets; a Solana
        // payment has neither, so offering Solana here always fails.
        evmOnly: true,
    }),
] as const;
