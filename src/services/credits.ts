/**
 * Agent Credit Accounts Service (Durable Object backed)
 *
 * Manages prepaid credit accounts for agents.
 * - Proxies requests to CREDIT_MANAGER Durable Object
 * - Handles atomic debits/credits via DO
 */

import { PRICING } from "../config";

/** Agent credit account state backed by Durable Object storage. */
export interface CreditAccount {
    walletAddress: string;
    balance: number;
    totalDeposited: number;
    totalSpent: number;
    createdAt: string;
    lastActivityAt: string;
    tier: "standard" | "gold" | "platinum";
}

/** A single credit transaction (deposit, spend, or bonus). */
export interface CreditTransaction {
    id: string;
    type: "deposit" | "spend" | "bonus";
    amount: number;
    description: string;
    timestamp: string;
    metadata?: Record<string, unknown>;
}

/**
 * Get the stub for a specific wallet's credit account
 */
function getAccountStub(namespace: DurableObjectNamespace, wallet: string) {
    const id = namespace.idFromName(wallet.toLowerCase());
    return namespace.get(id);
}

/**
 * Get credit account for a wallet.
 */
export async function getCreditAccount(
    namespace: DurableObjectNamespace,
    wallet: string,
): Promise<CreditAccount | null> {
    const stub = getAccountStub(namespace, wallet);
    const res = await stub.fetch("http://do/balance");

    if (res.status === 404) {return null;}
    if (!res.ok) {throw new Error("Failed to fetch balance");}

    return await res.json<CreditAccount>();
}

/**
 * Process a credit purchase (deposit).
 */
export async function processDeposit(
    namespace: DurableObjectNamespace,
    wallet: string,
    amountUsd: number,
    txId: string,
): Promise<{ account: CreditAccount; bonusAccrued: number }> {
    const bonus = calculateBonus(amountUsd);
    const totalAmount = amountUsd + bonus;

    const stub = getAccountStub(namespace, wallet);
    const res = await stub.fetch("http://do/deposit", {
        method: "POST",
        body: JSON.stringify({
            amount: totalAmount,
            description: "Credit purchase via x402",
            metadata: { txId, originalAmount: amountUsd, bonus }
        })
    });

    if (!res.ok) {throw new Error("Deposit failed");}

    // Consume the response body
    await res.json();

    // We fetch the full account to return it
    const account = await getCreditAccount(namespace, wallet);
    if (!account) {throw new Error("Account missing after deposit");}

    return { account, bonusAccrued: bonus };
}

/**
 * Deduct credits from account.
 */
export async function deductCredits(
    namespace: DurableObjectNamespace,
    wallet: string,
    amountUsd: number,
    description: string,
    requestId: string,
): Promise<CreditAccount> {
    const stub = getAccountStub(namespace, wallet);
    const res = await stub.fetch("http://do/spend", {
        method: "POST",
        body: JSON.stringify({
            amount: amountUsd,
            description,
            metadata: { requestId }
        })
    });

    if (res.status === 402) {
        throw new Error("Insufficient credits");
    }
    if (!res.ok) {
        throw new Error("Deduction failed");
    }

    const account = await getCreditAccount(namespace, wallet);
    if (!account) {throw new Error("Account missing after deduction");}

    return account;
}

/**
 * Get transaction history.
 */
export async function getTransactionHistory(
    namespace: DurableObjectNamespace,
    wallet: string,
): Promise<CreditTransaction[]> {
    const stub = getAccountStub(namespace, wallet);
    const res = await stub.fetch("http://do/history");

    if (!res.ok) {return [];}

    return await res.json<CreditTransaction[]>();
}

/**
 * Calculate bonus for a deposit amount.
 */
export function calculateBonus(depositAmount: number): number {
    const tiers = PRICING.credits.tiers;
    // Sort tiers descending by minDeposit to find highest applicable tier
    const sortedTiers = [...tiers].sort((a, b) => {
        const valA = parseFloat(a.minDeposit.replace("$", ""));
        const valB = parseFloat(b.minDeposit.replace("$", ""));
        return valB - valA;
    });

    for (const tier of sortedTiers) {
        const minVal = parseFloat(tier.minDeposit.replace("$", ""));
        if (depositAmount >= minVal) {
            return depositAmount * tier.bonus;
        }
    }
    return 0;
}
