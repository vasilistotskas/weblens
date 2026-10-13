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
        group: "Credits",
        operationId: "buyCredits",
        latency: "1-3 seconds",
        previewSummary: "Prepay credits; deposit bonuses at $10 / $50 / $100.",
        description: "Buy prepaid credits for WebLens API. Credits are used for all paid endpoints and offer bonuses at $10/$50/$100 tiers.",
        catalogTags: ["billing", "credits"],
        input: CreditsBuyRequestSchema,
        inputExample: { amount: 10 },
        outputExample: {
            success: true,
            duplicate: false,
            message: "Successfully added $10.00 to your account",
            added: "$10.00",
            bonus: "$2.00",
            newBalance: "$12.0000",
            tier: "standard",
            requestId: "req_credits456",
        },
        outputSchema: {
            properties: {
                success: { type: "boolean" },
                duplicate: { type: "boolean", description: "True when this payment was already applied; nothing was added" },
                message: { type: "string" },
                added: { type: "string", description: "Amount added, e.g. \"$10.00\"" },
                bonus: { type: "string", description: "Deposit bonus accrued, e.g. \"$2.00\"" },
                newBalance: { type: "string", description: "Balance after the deposit, e.g. \"$12.0000\"" },
                tier: { type: "string", description: "standard, premium or enterprise" },
                requestId: { type: "string" },
            },
        },
        // The buyer names the amount; the price is that amount.
        price: {
            resolve: (body) => `$${(body?.amount ?? CREDIT_PURCHASE_USD.min).toFixed(2)}`,
            min: CREDIT_PURCHASE_USD.min,
            max: CREDIT_PURCHASE_USD.max,
            describe: `the amount you buy, $${String(CREDIT_PURCHASE_USD.min)}-$${String(CREDIT_PURCHASE_USD.max)}`,
        },
        // Credits cannot buy credits.
        acceptsCredits: false,
        // The handler credits the payer it reads from the EIP-3009
        // authorization.from, and credit accounts are EVM wallets; a Solana
        // payment has neither, so offering Solana here always fails.
        evmOnly: true,
    }),
] as const;
