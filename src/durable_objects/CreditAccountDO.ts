import { DurableObject } from "cloudflare:workers";
import type { Env } from "../types";

interface CreditAccount {
    balance: number;
    tier: "standard" | "premium" | "enterprise";
    totalDeposited: number;
    totalSpent: number;
    history: Transaction[];
}

interface Transaction {
    id: string;
    type: "deposit" | "spend" | "refund";
    amount: number;
    description: string;
    timestamp: string;
    metadata?: Record<string, unknown>;
}

interface DepositRequest {
    amount: number;
    description: string;
    metadata?: Record<string, unknown>;
}

interface SpendRequest {
    amount: number;
    description: string;
    metadata?: Record<string, unknown>;
}

export class CreditAccountDO extends DurableObject<Env> {
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        // Initialize account state if needed
        let account = await this.ctx.storage.get<CreditAccount>("account");
        account ??= {
            balance: 0,
            tier: "standard",
            totalDeposited: 0,
            totalSpent: 0,
            history: [],
        };

        if (path === "/deposit" && request.method === "POST") {
            const body: DepositRequest = await request.json();

            account.balance += body.amount;
            account.totalDeposited += body.amount;

            const tx: Transaction = {
                id: crypto.randomUUID(),
                type: "deposit",
                amount: body.amount,
                description: body.description,
                timestamp: new Date().toISOString(),
                metadata: body.metadata,
            };

            account.history.unshift(tx);
            // Keep only last 100 transactions
            if (account.history.length > 100) {account.history.pop();}

            // Update tier based on total deposited
            if (account.totalDeposited >= 1000) {account.tier = "enterprise";}
            else if (account.totalDeposited >= 100) {account.tier = "premium";}

            await this.ctx.storage.put("account", account);

            return Response.json({ success: true, balance: account.balance, txId: tx.id });
        }

        if (path === "/spend" && request.method === "POST") {
            const body: SpendRequest = await request.json();

            if (account.balance < body.amount) {
                return Response.json({ error: "Insufficient funds" }, { status: 402 });
            }

            account.balance -= body.amount;
            account.totalSpent += body.amount;

            const tx: Transaction = {
                id: crypto.randomUUID(),
                type: "spend",
                amount: -body.amount,
                description: body.description,
                timestamp: new Date().toISOString(),
                metadata: body.metadata,
            };

            account.history.unshift(tx);
            if (account.history.length > 100) {account.history.pop();}

            await this.ctx.storage.put("account", account);

            return Response.json({ success: true, balance: account.balance, txId: tx.id });
        }

        if (path === "/balance" && request.method === "GET") {
            return Response.json(account);
        }

        if (path === "/history" && request.method === "GET") {
            return Response.json(account.history);
        }

        return new Response("Not Found", { status: 404 });
    }
}
