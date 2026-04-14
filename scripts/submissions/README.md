# WebLens distribution submissions

Everything needed to get WebLens listed in the directories/channels that
actually produce paying traffic. Ordered by ROI × effort.

## Day 1 — free, ~4 hours

1. **Bootstrap CDP Bazaar** — `pnpm run bootstrap-payment` (needs funded Base wallet)
2. **Publish `@weblens/mcp` to npm** — `cd mcp-server && npm publish --access public`
3. **x402scan.com/resources/register** — instant, no review
4. **x402 Foundation PR** — see [`x402-foundation/`](./x402-foundation/)
5. **awesome-x402 PR** — see [`awesome-x402/`](./awesome-x402/)
6. **Email Cloudflare** — see [`outreach/cloudflare-x402-email.md`](./outreach/cloudflare-x402-email.md)

## Week 1 — MCP pivot (the only channel with real revenue)

7. **Official MCP Registry** — see [`mcp-registry/`](./mcp-registry/) (depends on #2)
8. **Anthropic Connectors Directory** — https://docs.google.com/forms/d/e/1FAIpQLSeafJF2NDI7oYx1r8o0ycivCSVLNq92Mpc1FPxMKSw1CzDkqA/viewform
9. **Smithery.ai** — `smithery mcp publish https://api.weblens.dev/mcp -n dev.weblens/weblens`
10. **PulseMCP / Glama.ai / mcp.so / mcpmarket.com / LobeHub / mcpservers.org** — batch form submissions
11. **DM @murrlincoln** — see [`outreach/x402-grant-dm.md`](./outreach/x402-grant-dm.md)

## Week 2 — sponsor + outreach

12. **ETHGlobal Open Agents** (ends 2026-04-26) — submit $500 in credits as prize
13. **Reply to @CoinbaseDev** Bazaar launch thread with `/discovery` link
14. **Composio** custom-integration PR (uses your `/openapi.json`)
15. **LangChain reference x402 retriever** — claim issue #35853

## How to use this directory

Each subfolder has:
- The raw asset (JSON/SVG/MD) ready to commit to a fork or paste into a form
- A `README.md` with the exact steps (CLI commands, PR description, SLA)
