/**
 * Agent Dashboard
 * 
 * Simple HTML UI for connecting wallet and viewing credit stats.
 * Serves a single HTML page with client-side logic.
 */

import type { Context } from "hono";
import type { Env } from "../types";

const DASHBOARD_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WebLens Agent Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="module">
        import { createWalletClient, custom } from 'https://esm.sh/viem';
        import { mainnet, base } from 'https://esm.sh/viem/chains';

        let walletClient;
        let account;

        async function connectWallet() {
            if (!window.ethereum) {
                alert("Please install Coinbase Wallet or Metamask");
                return;
            }
            walletClient = createWalletClient({
                chain: base,
                transport: custom(window.ethereum)
            });
            const [address] = await walletClient.requestAddresses();
            account = address;
            document.getElementById('connect-btn').innerText = account.slice(0,6) + '...' + account.slice(-4);
            document.getElementById('dashboard-content').classList.remove('hidden');
            loadData();
        }

        async function getAuthHeaders() {
            const timestamp = Date.now().toString();
            const message = \`WebLens Authentication\\nWallet: \${account}\\nTimestamp: \${timestamp}\`;
            const signature = await walletClient.signMessage({
                account,
                message
            });
            return {
                "X-CREDIT-WALLET": account,
                "X-CREDIT-SIGNATURE": signature,
                "X-CREDIT-TIMESTAMP": timestamp
            };
        }

        async function loadData() {
            const headers = await getAuthHeaders();
            
            // Fetch Balance
            const balanceRes = await fetch('/credits/balance', { headers });
            const balanceData = await balanceRes.json();
            document.getElementById('balance-display').innerText = balanceData.balance;
            document.getElementById('tier-display').innerText = balanceData.tier.toUpperCase();

            // Fetch History
            const historyRes = await fetch('/credits/history', { headers });
            const historyData = await historyRes.json();
            const historyList = document.getElementById('history-list');
            historyList.innerHTML = historyData.history.map(tx => \`
                <div class="flex justify-between py-2 border-b border-gray-700">
                    <div>
                        <div class="font-bold">\${tx.description}</div>
                        <div class="text-xs text-gray-400">\${new Date(tx.timestamp).toLocaleString()}</div>
                    </div>
                    <div class="\${tx.amount < 0 ? 'text-red-400' : 'text-green-400'}">
                        \${tx.amount < 0 ? '-' : '+'}\${Math.abs(tx.amount).toFixed(4)}
                    </div>
                </div>
            \`).join('');
        }

        window.connectWallet = connectWallet;
    </script>
</head>
<body class="bg-gray-900 text-white font-sans">
    <div class="container mx-auto px-4 py-8">
        <div class="flex justify-between items-center mb-8">
            <h1 class="text-2xl font-bold text-blue-400">WebLens Authorization</h1>
            <button id="connect-btn" onclick="connectWallet()" class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded font-medium transition">
                Connect Wallet
            </button>
        </div>

        <div id="dashboard-content" class="hidden space-y-6">
            <!-- Balance Card -->
            <div class="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700">
                <div class="text-gray-400 text-sm mb-1">Available Credits</div>
                <div class="flex items-end gap-3">
                    <div id="balance-display" class="text-4xl font-bold text-white">$0.0000</div>
                    <div id="tier-display" class="text-sm font-semibold text-blue-400 mb-1 px-2 py-0.5 bg-blue-900/30 rounded">STANDARD</div>
                </div>
                <div class="mt-4 text-sm text-gray-400">
                    To deposit, use the <code class="bg-gray-700 px-1 py-0.5 rounded">/credits/buy</code> endpoint via your agent.
                </div>
            </div>

            <!-- History -->
            <div class="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700">
                <h2 class="text-xl font-bold mb-4">Transaction History</h2>
                <div id="history-list" class="space-y-1">
                    <div class="text-gray-500 text-center py-4">Loading...</div>
                </div>
            </div>
            
            <!-- Docs Link -->
             <div class="text-center mt-8">
                <a href="/docs" class="text-blue-400 hover:underline">View API Documentation</a>
            </div>
        </div>
        
        <div class="mt-12 text-center text-gray-600 text-sm">
            WebLens Knowledge Arbitrageur • Powered by x402 & Coinbase CDP
        </div>
    </div>
</body>
</html>
`;

export function dashboardHandler(c: Context<{ Bindings: Env }>) {
    return c.html(DASHBOARD_HTML);
}
