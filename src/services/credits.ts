/**
 * Agent Credit Accounts Service (Clearing House Seed)
 *
 * Manages prepaid credit accounts for agents.
 * - Stores balances and transaction history in CREDITS KV
 * - Handles atomic(ish) debits/credits
 * - Implements tiered bonuses
 */

import { PRICING } from "../config";

// ============================================
// Types
// ============================================

export interface CreditAccount {
    walletAddress: string;
    balance: number; // Stored in USD (as float for now, or cents) - Using float for simplicity with string parsing
    totalDeposited: number;
    totalSpent: number;
    createdAt: string;
    lastActivityAt: string;
    tier: "standard" | "gold" | "platinum";
}

export interface CreditTransaction {
    id: string;
    type: "deposit" | "spend" | "bonus";
    amount: number;
    description: string;
    timestamp: string;
    metadata?: Record<string, unknown>;
}

export interface CreditTier {
    minDeposit: number;
    bonusMultiplier: number; // e.g., 0.20 for 20%
}

// ============================================
// Constants
// ============================================

const ACCOUNT_PREFIX = "account:";
const HISTORY_PREFIX = "history:";

// ============================================
// Helpers
// ============================================

function getAccountKey(wallet: string): string {
    return `${ACCOUNT_PREFIX}${wallet.toLowerCase()}`;
}

function getHistoryKey(wallet: string): string {
    return `${HISTORY_PREFIX}${wallet.toLowerCase()}`;
}

function parseCurrency(amount: string): number {
    return parseFloat(amount.replace("$", ""));
}

function formatCurrency(amount: number): string {
    return `$${amount.toFixed(4)}`;
}

// ============================================
// Service Logic
// ============================================

/**
 * Get credit account for a wallet. Returns null if not exists.
 */
export async function getCreditAccount(
    kv: KVNamespace,
    wallet: string,
): Promise<CreditAccount | null> {
    const data = await kv.get(getAccountKey(wallet));
    if (!data) {return null;}
    return JSON.parse(data) as CreditAccount;
}

/**
 * Create or get credit account. Returns default if new.
 */
export async function getOrCreateCreditAccount(
    kv: KVNamespace,
    wallet: string,
): Promise<CreditAccount> {
    const existing = await getCreditAccount(kv, wallet);
    if (existing) {return existing;}

    return {
        walletAddress: wallet.toLowerCase(),
        balance: 0,
        totalDeposited: 0,
        totalSpent: 0,
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        tier: "standard",
    };
}

/**
 * Save credit account to KV.
 */
async function saveCreditAccount(kv: KVNamespace, account: CreditAccount): Promise<void> {
    account.lastActivityAt = new Date().toISOString();
    await kv.put(getAccountKey(account.walletAddress), JSON.stringify(account));
}

/**
 * Append transaction to history (stored as a list of recent txs).
 * We limit history to last 50 items to keep KV size manageable.
 */
async function appendTransaction(
    kv: KVNamespace,
    wallet: string,
    tx: CreditTransaction,
): Promise<void> {
    const key = getHistoryKey(wallet);
    const data = await kv.get(key);
    let history: CreditTransaction[] = data ? (JSON.parse(data) as CreditTransaction[]) : [];

    history.unshift(tx); // Add to beginning
    if (history.length > 50) {
        history = history.slice(0, 50);
    }

    await kv.put(key, JSON.stringify(history));
}

/**
 * Calculate bonus for a deposit amount.
 */
export function calculateBonus(depositAmount: number): number {
    const tiers = PRICING.credits.tiers;
    // Sort tiers descending by minDeposit to find highest applicable tier
    const sortedTiers = [...tiers].sort((a, b) =>
        parseCurrency(b.minDeposit) - parseCurrency(a.minDeposit)
    );

    for (const tier of sortedTiers) {
        if (depositAmount >= parseCurrency(tier.minDeposit)) {
            return depositAmount * tier.bonus;
        }
    }
    return 0;
}

/**
 * Process a credit purchase (deposit).
 * - Verifies x402 payment (handled by caller/middleware)
 * - Calculates bonus
 * - Updates balance
 * - Records transaction
 */
export async function processDeposit(
    kv: KVNamespace,
    wallet: string,
    amountUsd: number,
    txId: string,
): Promise<{ account: CreditAccount; bonusAccrued: number }> {
    const account = await getOrCreateCreditAccount(kv, wallet);
    const bonus = calculateBonus(amountUsd);

    account.balance += amountUsd + bonus;
    account.totalDeposited += amountUsd;

    // Update tier based on total deposited (simple logic for now)
    if (account.totalDeposited >= 1000) {account.tier = "platinum";}
    else if (account.totalDeposited >= 100) {account.tier = "gold";}

    await saveCreditAccount(kv, account);

    // Record Deposit Tx
    await appendTransaction(kv, wallet, {
        id: txId,
        type: "deposit",
        amount: amountUsd,
        description: "Credit purchase via x402",
        timestamp: new Date().toISOString(),
    });

    // Record Bonus Tx if any
    if (bonus > 0) {
        await appendTransaction(kv, wallet, {
            id: `${txId}-bonus`,
            type: "bonus",
            amount: bonus,
            description: "Deposit bonus",
            timestamp: new Date().toISOString(),
        });
    }

    return { account, bonusAccrued: bonus };
}

/**
 * Deduct credits from account.
 * Throws error if insufficient funds.
 */
export async function deductCredits(
    kv: KVNamespace,
    wallet: string,
    amountUsd: number,
    description: string,
    requestId: string,
): Promise<CreditAccount> {
    // Note: KV read-modify-write is not strictly atomic.
    // For high-volume implementations, use Durable Objects or atomic counters.
    // For this MVP seed, we accept the small race condition risk.

    const account = await getCreditAccount(kv, wallet);
    if (!account) {
        throw new Error("Account not found");
    }

    if (account.balance < amountUsd) {
        throw new Error(`Insufficient credits. Balance: ${formatCurrency(account.balance)}, Required: ${formatCurrency(amountUsd)}`);
    }

    account.balance -= amountUsd;
    account.totalSpent += amountUsd;

    await saveCreditAccount(kv, account);

    await appendTransaction(kv, wallet, {
        id: requestId,
        type: "spend",
        amount: -amountUsd,
        description,
        timestamp: new Date().toISOString(),
    });

    return account;
}

/**
 * Get transaction history.
 */
export async function getTransactionHistory(
    kv: KVNamespace,
    wallet: string,
): Promise<CreditTransaction[]> {
    const data = await kv.get(getHistoryKey(wallet));
    if (!data) {return [];}
    return JSON.parse(data) as CreditTransaction[];
}
