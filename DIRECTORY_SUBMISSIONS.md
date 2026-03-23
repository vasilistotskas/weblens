# WebLens Directory Submission Guide

Step-by-step instructions for listing WebLens across all relevant directories.

---

## 1. x402 Ecosystem (Priority: Highest)

### awesome-x402 (GitHub PR)
- **URL**: https://github.com/xpaysh/awesome-x402
- **Action**: Fork repo, add entry to README.md under Services/APIs section, open PR
- **Content**: See `AWESOME_X402_SUBMISSION.md` in this repo
- **Effort**: 30 minutes

### x402list.fun
- **URL**: https://x402list.fun
- **Action**: Services are indexed automatically when facilitators process payments. Verify your `/.well-known/x402` endpoint returns correct data. May also have a submission form.
- **Verify**: `curl https://api.weblens.dev/.well-known/x402`

### x402index.com
- **URL**: https://www.x402index.com
- **Action**: Submit your service URL for indexing
- **Submit**: https://api.weblens.dev

### x402.org/ecosystem
- **URL**: https://www.x402.org/ecosystem
- **Action**: Check if there's a submission form or GitHub repo accepting PRs
- **Category**: Services > Web Intelligence / Web Scraping

---

## 2. MCP Registries (Priority: High)

### Official MCP Registry
- **URL**: https://registry.modelcontextprotocol.io
- **Action**: Use the publisher CLI to register
- **Steps**:
  1. `make publisher` or download the binary
  2. Authenticate via GitHub OAuth
  3. Register namespace (e.g., `io.github.yourname/weblens`)
  4. Submit server metadata pointing to `https://api.weblens.dev/mcp`
- **Transport**: `streamable-http`
- **Effort**: 1 hour

### PulseMCP
- **URL**: https://www.pulsemcp.com/servers
- **Submit**: https://www.pulsemcp.com/use-cases/submit
- **Info to provide**:
  - Name: WebLens
  - URL: https://api.weblens.dev/mcp
  - Description: Web Intelligence API for AI agents with x402 micropayments. 10 tools: web scraping, JS rendering, screenshots, search, data extraction, AI research, PDF parsing, batch fetch, URL comparison.
  - Transport: HTTP (Streamable)
- **Effort**: 15 minutes

### MCP.so
- **URL**: https://mcp.so
- **Action**: Submit your MCP server
- **Effort**: 15 minutes

### Glama
- **URL**: https://glama.ai/mcp/servers
- **Action**: Submit for editorial review
- **Effort**: 15 minutes

### MCP Market
- **URL**: https://mcpmarket.com
- **Action**: Register and submit server
- **Effort**: 15 minutes

### OpenTools
- **URL**: https://opentools.com/registry
- **Action**: Submit tool registry entry
- **Effort**: 15 minutes

### MCP-Get
- **URL**: https://mcp-get.com
- **Action**: Submit (includes uptime monitoring)
- **Effort**: 15 minutes

---

## 3. AI Agent Directories (Priority: Medium)

### AI Agents Directory
- **URL**: https://aiagentsdirectory.com
- **Action**: List WebLens as an AI agent tool/API
- **Category**: Web Tools / Data Extraction
- **Effort**: 15 minutes

### AI Agent Store
- **URL**: https://aiagentstore.ai
- **Action**: Register as a tool provider
- **Effort**: 15 minutes

### AI Agents List
- **URL**: https://aiagentslist.com
- **Action**: Submit tool listing
- **Effort**: 15 minutes

### StackOne AI Agent Tools Landscape
- **URL**: https://www.stackone.com/blog/ai-agent-tools-landscape-2026/
- **Action**: Contact for inclusion in landscape map
- **Category**: Web Intelligence / Data
- **Effort**: 15 minutes

---

## 4. API Marketplaces (Priority: Medium)

### RapidAPI
- **URL**: https://rapidapi.com
- **Action**: Create provider account, list WebLens API
- **Category**: Web Scraping / Data
- **Note**: RapidAPI proxies requests; you may need to add their gateway support
- **Effort**: 2-3 hours

### Apify Store
- **URL**: https://apify.com/store
- **Action**: Build a WebLens "Actor" wrapper
- **Note**: New creators get $500 free credits; top creators earn $2K+/month
- **Effort**: 1-2 days

---

## 5. Launch Events (Priority: High)

### Hacker News — Show HN
- **When**: Monday or Tuesday morning (US time)
- **Title**: `Show HN: WebLens – Web intelligence API for AI agents with x402 micropayments`
- **Post content**:
  - Link to live API or GitHub repo (not a signup page)
  - Introduce yourself as a builder
  - Explain the problem (AI agents need web data, current APIs need accounts/keys)
  - Show the solution (x402 pay-per-request, zero-friction reader)
  - Include live examples: `curl https://api.weblens.dev/r/https://example.com`
  - Invite feedback
- **Key rules**: No friends posting support. Answer every comment quickly. Agree with valid criticism.
- **Effort**: 1 day prep, 1 day engagement

### Product Hunt
- **When**: Weekday at 12:01 AM Pacific
- **Prep**:
  1. Recruit an experienced Hunter to review listing
  2. Prepare visual gallery (screenshots of API calls, responses, docs)
  3. Write Maker Comment (under 800 chars): what's launching, why it matters, one use case, one CTA
  4. Prepare for first 4 hours (critical ranking period)
- **Effort**: 1 week prep

---

## 6. Content Marketing (Priority: Medium, Ongoing)

### Dev.to / Hashnode Articles
- "Give Your AI Agent Web Superpowers with x402 Micropayments"
- "Building a Pay-Per-Request API on Cloudflare Workers with x402"
- "Zero-Friction Web Scraping: The Jina Reader Pattern with x402"

### Reddit
- **r/SaaS** (386K) — Self-promotion allowed in weekly threads
- **r/AI_Agents** — Direct target audience
- **r/webdev** (3.1M) — Designated showcase threads
- **r/programming** (4M) — Technical value only, no self-promotion
- **Rule**: 90% genuine participation, 10% promotional

### Twitter/X
- Post technical deep-dives
- Share integration examples
- Engage with @CoinbaseDev, @CloudflareDev, x402 community
- Tag #x402 #MCP #AIAgents

---

## 7. Framework Integrations (Priority: High, Week 3+)

Building integrations creates organic discovery:

- **LangChain tool** — `WebLensTool` wrapping fetch/search/extract
- **LlamaIndex reader** — `WebLensReader` for data loading
- **n8n node** — WebLens node for workflow automation
- **Zapier connector** — WebLens actions
- Each framework has its own submission process for community tools

---

## Submission Checklist

- [ ] awesome-x402 PR
- [ ] x402index.com
- [ ] x402.org/ecosystem
- [ ] Official MCP Registry
- [ ] PulseMCP
- [ ] MCP.so
- [ ] Glama
- [ ] MCP Market
- [ ] AI Agents Directory
- [ ] AI Agent Store
- [ ] AI Agents List
- [ ] Show HN post (draft)
- [ ] Product Hunt (prep)
- [ ] First Dev.to article
- [ ] Reddit r/SaaS introduction
