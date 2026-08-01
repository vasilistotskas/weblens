# Distribution

Where WebLens gets listed so buyers can find it, and exactly what to run.

Context for why this file exists: on x402, the whole ecosystem transacts
~$712K/30 days across ~87,000 sellers, and **Exa — the category leader in web
search/crawl — earns $43.57/month there**. That is the ceiling of our category
on that rail, not our floor. The buyers who actually pay for scraping and
crawling find tools through MCP clients and scraping marketplaces, so that is
where the listings need to be.

Everything below needs an account we own, so it is a runbook rather than
something that could be automated from the repo.

---

## 1. Official MCP Registry

The canonical index that MCP clients query programmatically. WebLens is listed
as a **remote** server — users connect straight to `https://api.weblens.dev/mcp`
with nothing to install.

`server.json` in the repo root is ready to publish as-is.

### Install the CLI

```bash
brew install mcp-publisher
# or, on Windows:
#   Invoke-WebRequest -Uri "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_windows_amd64.tar.gz" -OutFile "mcp-publisher.tar.gz"
#   tar xf mcp-publisher.tar.gz mcp-publisher.exe
```

### Authenticate (DNS — gives us the `dev.weblens/*` namespace)

`server.json` claims the name `dev.weblens/weblens`, which requires proving we
own `weblens.dev`. Generate a keypair and publish the TXT record:

```bash
MY_DOMAIN="weblens.dev"

openssl genpkey -algorithm Ed25519 -out key.pem
PUBLIC_KEY="$(openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64)"
echo "${MY_DOMAIN}. IN TXT \"v=MCPv1; k=ed25519; p=${PUBLIC_KEY}\""
```

Add that TXT record on `weblens.dev` in the Cloudflare dashboard, wait for it
to propagate, then:

```bash
PRIVATE_KEY="$(openssl pkey -in key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n')"
mcp-publisher login dns --domain "weblens.dev" --private-key "${PRIVATE_KEY}"
mcp-publisher publish
```

**Keep `key.pem` out of git.** It is the credential for the namespace.

> Faster fallback if the DNS record is a problem: run `mcp-publisher login github`
> instead and change the `name` in `server.json` to
> `io.github.vasilistotskas/weblens`. GitHub auth only authorizes the
> `io.github.<user>/*` namespace, so the name must match the auth method.

### Verify

```bash
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=dev.weblens/weblens"
```

---

## 2. MCP directories

These drive most human discovery. None of them require the registry entry above,
and all are free.

| Directory | How to get listed | Notes |
|---|---|---|
| **Glama** | Auto-indexes public GitHub repos | Already possible — the repo is public. Listing quality improves with a good README. |
| **PulseMCP** | Hand-reviewed submission form at pulsemcp.com | Largest curated directory. |
| **MCP.so** | Submission form | Broad automated coverage. |
| **Smithery** | Needs a Smithery account + `smithery.yaml` in the repo root | Also offers hosting; we only need the listing since `/mcp` is already hosted. |

Directories rank free-tier availability highly — worth leading every listing
with the free surfaces we already have: `GET /r/{url}`, `GET /s/{query}`, and
`POST /preview`.

---

## 3. Apify Store

The best-proven revenue channel for this exact product category: ~3,000 actors,
90,000+ users actively searching for scraping tools, Apify handles billing and
payouts, and takes 20%. **Standby mode** turns an actor into a real-time HTTP
API, which maps cleanly onto what WebLens already is, and with pay-per-event
pricing in Standby we are not liable for users' platform usage costs.

This one is **not ready to ship** and needs a decision first, because an Apify
actor has to reach WebLens's paid endpoints and WebLens currently has exactly
two ways to pay — an x402 signature or a wallet-signed credit account. Neither
fits a server-side actor. The options:

- **(a) Self-contained actor.** The actor does the scraping itself, reusing
  `src/services/crawler.ts` logic as a small Node package. No dependency on the
  API at all. More code to maintain, but no auth question and no coupling.
- **(b) Actor proxies to WebLens** using a single privileged internal key that
  only our own actor holds. Small change (one header check ahead of the payment
  middleware, plus a secret), and Apify becomes the merchant of record. This is
  not a customer-facing card flow — it is one trusted internal caller.

(b) is less work and keeps one implementation of the scraping logic. It does
mean adding a bypass to the money path, so it wants care: the key goes in
`wrangler secret`, never in the repo, and the bypass should be logged.

Once that is settled, the actor needs `.actor/actor.json`, a Dockerfile, an
input schema, and a README, then `apify push` followed by publishing from the
Apify Console.

---

## 4. After listing

Watch for the thing our logs cannot currently show: whether a discovery event
turns into a paid call. The `/preview` endpoint and the receipt middleware
already give us the two ends of that funnel.
