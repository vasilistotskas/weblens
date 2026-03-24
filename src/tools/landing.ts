/**
 * HTML Landing Page
 *
 * Returns a styled landing page when browsers visit /.
 * Agents/API clients get JSON (via Accept header detection).
 */

import { PRICING } from "../config";

export function getLandingPageHTML(baseUrl: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WebLens — Web Intelligence API for AI Agents</title>
<meta name="description" content="Premium web scraping, search, and data extraction API with x402 micropayments. No accounts, no API keys. Pay per request with USDC.">
<meta property="og:title" content="WebLens — Web Intelligence API for AI Agents">
<meta property="og:description" content="Give your AI agents web superpowers. Pay-per-request with USDC on Base via x402.">
<meta property="og:url" content="${baseUrl}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="WebLens — Web Intelligence API for AI Agents">
<meta name="twitter:description" content="Web scraping, search, and extraction API. No accounts, just pay per request with USDC.">
<link rel="canonical" href="${baseUrl}">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#e0e0e0;line-height:1.6}
a{color:#60a5fa;text-decoration:none}
a:hover{text-decoration:underline}
.container{max-width:900px;margin:0 auto;padding:2rem 1.5rem}
header{text-align:center;padding:3rem 0 2rem}
h1{font-size:2.5rem;font-weight:700;color:#fff;letter-spacing:-0.02em}
h1 span{color:#60a5fa}
.tagline{color:#9ca3af;font-size:1.1rem;margin-top:0.5rem}
.badges{margin-top:1rem;display:flex;gap:0.5rem;justify-content:center;flex-wrap:wrap}
.badge{display:inline-block;padding:0.25rem 0.75rem;border-radius:9999px;font-size:0.8rem;font-weight:500}
.badge-blue{background:#1e3a5f;color:#60a5fa}
.badge-green{background:#14532d;color:#4ade80}
.badge-purple{background:#3b1f6e;color:#c084fc}
.try-it{background:#111;border:1px solid #333;border-radius:12px;padding:1.5rem;margin:2rem 0;text-align:center}
.try-it h2{font-size:1.2rem;color:#fff;margin-bottom:1rem}
.try-box{display:flex;gap:0.5rem;max-width:600px;margin:0 auto}
.try-box input{flex:1;background:#1a1a1a;border:1px solid #444;border-radius:8px;padding:0.6rem 1rem;color:#fff;font-size:0.95rem;font-family:monospace}
.try-box input::placeholder{color:#666}
.try-box button{background:#2563eb;color:#fff;border:none;border-radius:8px;padding:0.6rem 1.25rem;font-size:0.95rem;cursor:pointer;white-space:nowrap}
.try-box button:hover{background:#1d4ed8}
.curl-example{margin-top:1rem;color:#9ca3af;font-size:0.85rem;font-family:monospace}
.result-box{margin-top:1rem;background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:1rem;text-align:left;font-family:monospace;font-size:0.85rem;color:#d1d5db;max-height:300px;overflow-y:auto;display:none;white-space:pre-wrap;word-break:break-word}
section{margin:2rem 0}
h2{font-size:1.3rem;color:#fff;margin-bottom:1rem;padding-bottom:0.5rem;border-bottom:1px solid #222}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem}
.card{background:#111;border:1px solid #222;border-radius:10px;padding:1.25rem}
.card h3{font-size:1rem;color:#fff;margin-bottom:0.25rem}
.card .price{color:#4ade80;font-size:0.85rem;font-weight:600}
.card p{color:#9ca3af;font-size:0.85rem;margin-top:0.25rem}
.links{display:flex;flex-wrap:wrap;gap:0.75rem;margin-top:1.5rem;justify-content:center}
.link-btn{display:inline-block;padding:0.5rem 1rem;background:#111;border:1px solid #333;border-radius:8px;color:#e0e0e0;font-size:0.9rem;transition:border-color 0.2s}
.link-btn:hover{border-color:#60a5fa;text-decoration:none}
footer{text-align:center;padding:2rem 0;color:#666;font-size:0.8rem;border-top:1px solid #222;margin-top:2rem}
code{background:#1a1a1a;padding:0.15rem 0.4rem;border-radius:4px;font-size:0.85em}
</style>
</head>
<body>
<div class="container">
<header>
<h1>Web<span>Lens</span></h1>
<p class="tagline">Web Intelligence API for AI Agents — powered by x402 micropayments</p>
<div class="badges">
<span class="badge badge-blue">x402 Protocol</span>
<span class="badge badge-green">USDC on Base</span>
<span class="badge badge-purple">MCP Server</span>
</div>
</header>

<div class="try-it">
<h2>Try it now — no signup needed</h2>
<div class="try-box">
<input type="text" id="url-input" placeholder="https://example.com" value="https://example.com">
<button onclick="tryFetch()">Fetch</button>
</div>
<p class="curl-example">or: <code>curl ${baseUrl}/r/https://example.com</code></p>
<div class="result-box" id="result"></div>
</div>

<section>
<h2>Zero-Friction Endpoints (Free)</h2>
<div class="grid">
<div class="card">
<h3>Reader</h3>
<span class="price">FREE</span>
<p>GET /r/{url} — Fetch any webpage as markdown. No auth, no POST body.</p>
</div>
<div class="card">
<h3>Search</h3>
<span class="price">FREE</span>
<p>GET /s/{query} — Web search results. Just append your query.</p>
</div>
</div>
</section>

<section>
<h2>Paid Endpoints (x402 micropayments)</h2>
<div class="grid">
<div class="card">
<h3>Fetch Basic</h3>
<span class="price">${PRICING.fetch.basic}</span>
<p>Fast webpage to markdown. No JS rendering.</p>
</div>
<div class="card">
<h3>Fetch Pro</h3>
<span class="price">${PRICING.fetch.pro}</span>
<p>Full JavaScript rendering for SPAs and dynamic content.</p>
</div>
<div class="card">
<h3>Screenshot</h3>
<span class="price">${PRICING.screenshot}</span>
<p>Full-page PNG capture with custom viewports.</p>
</div>
<div class="card">
<h3>Web Search</h3>
<span class="price">${PRICING.search}</span>
<p>Real-time search with up to 20 results.</p>
</div>
<div class="card">
<h3>Data Extraction</h3>
<span class="price">${PRICING.extract}</span>
<p>Structured extraction with CSS selectors or AI.</p>
</div>
<div class="card">
<h3>AI Research</h3>
<span class="price">${PRICING.research}</span>
<p>Search + fetch + AI summary in one call.</p>
</div>
</div>
<p style="margin-top:0.75rem;color:#9ca3af;font-size:0.85rem;text-align:center">70% cache discount on all endpoints. <a href="${baseUrl}/docs">See all 15+ endpoints &rarr;</a></p>
</section>

<section>
<h2>How Payment Works</h2>
<p style="color:#9ca3af;font-size:0.9rem">
POST to any paid endpoint &rarr; get <code>402 Payment Required</code> with price &rarr; sign USDC transfer on Base &rarr; retry with payment header &rarr; get data. ~2 seconds. No accounts. No API keys. Your wallet is your identity.
</p>
</section>

<div class="links">
<a class="link-btn" href="${baseUrl}/docs">API Docs</a>
<a class="link-btn" href="${baseUrl}/openapi.json">OpenAPI Spec</a>
<a class="link-btn" href="${baseUrl}/llms.txt">LLMs.txt</a>
<a class="link-btn" href="${baseUrl}/discovery">Discovery</a>
<a class="link-btn" href="${baseUrl}/mcp/info">MCP Server</a>
<a class="link-btn" href="${baseUrl}/.well-known/x402">x402 Discovery</a>
</div>

<footer>
WebLens &mdash; Premium Web Intelligence API &mdash; Powered by <a href="https://x402.org">x402</a> + <a href="https://workers.cloudflare.com">Cloudflare Workers</a>
</footer>
</div>
<script>
async function tryFetch(){
var u=document.getElementById("url-input").value.trim();
var r=document.getElementById("result");
if(!u){r.style.display="block";r.textContent="Enter a URL";return}
r.style.display="block";
r.textContent="Fetching...";
try{
var res=await fetch("/r/"+u);
var d=await res.json();
if(res.status===429){r.textContent="Rate limit reached (10 free requests/hour).\\nTry again later or use the paid /fetch/basic endpoint for unlimited access.";return}
if(d.error){r.textContent="Error: "+(d.message||d.error);return}
r.textContent=d.content||JSON.stringify(d,null,2);
}catch(e){r.textContent="Error: "+e.message}
}
document.getElementById("url-input").addEventListener("keydown",function(e){if(e.key==="Enter")tryFetch()});
</script>
</body>
</html>`;
}
