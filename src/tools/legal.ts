/**
 * Terms of service, refund policy and privacy policy.
 *
 *   GET /terms    → who sells what, how each way of paying works, acceptable use, liability
 *   GET /refunds  → card credit refunds (matched to Link's 60-day window), failed calls, x402
 *   GET /privacy  → what WebLens processes, for how long, with whom, and the GDPR rights
 *
 * Every retention period quoted is read from the code or config that sets it,
 * so a change there changes the page.
 */

import type { Context } from "hono";
import { html } from "hono/html";
import { CACHE_TTL_SECONDS, FREE_TIER, LEGAL, OPERATOR, SERVICE_NAME } from "../config";
import { RECEIPT_TTL_SECONDS } from "../services/erc8004";
import type { AppEnv } from "../types";
import { htmlPage } from "../utils/html-page";

const DAY_SECONDS = 86_400;
const HOUR_SECONDS = 3_600;

const operatorLine = html`${OPERATOR.name}, ${OPERATOR.address}, ${OPERATOR.country}`;
const mail = html`<a href="mailto:${OPERATOR.email}">${OPERATOR.email}</a>`;
const updated = html`<p><em>Last updated ${LEGAL.updated}.</em></p>`;

export function termsHandler(c: Context<AppEnv>) {
    return c.html(htmlPage("Terms of Service", html`${updated}
<h2>1. Who we are</h2>
<p>${SERVICE_NAME} is operated by ${operatorLine} ("we"). Contact: ${mail}. These terms govern your use of the ${SERVICE_NAME} API, website and MCP server (the "service").</p>

<h2>2. The service</h2>
<p>${SERVICE_NAME} fetches, renders, searches and extracts publicly available web content on your request, and returns it through an HTTP API. The endpoints, their inputs, outputs and prices are documented at <a href="/docs">/docs</a> and <a href="/openapi.json">/openapi.json</a>.</p>

<h2>3. Paying</h2>
<p><strong>Per request (x402).</strong> A paid endpoint answers <code>402 Payment Required</code> with its price. You pay by signing a USDC transfer that settles on-chain. If the request fails, the payment is not settled. A settled payment is final.</p>
<p><strong>Prepaid API keys.</strong> You can buy a prepaid credit pack by card.</p>
<ul>
<li>Card purchases are sold through Link (Sold through Link, LLC, Stripe's affiliate), which is the merchant of record. Link charges your card, issues the receipt and invoice, and handles taxes. <a href="${LEGAL.linkTerms}">Link's terms</a> govern the purchase.</li>
<li>Pack prices include any VAT or sales tax. Credit is in US dollars at face value: a $10 pack costs $10 and buys $10 of calls. Credit does not expire.</li>
<li>Credit is not money and earns no interest. It cannot be transferred, and it cannot be exchanged for cash except under our <a href="${LEGAL.paths.refunds}">refund policy</a>.</li>
<li>Each call debits its listed price. The <code>Credit-Cost</code> and <code>Credit-Balance</code> response headers show the amount charged and what remains.</li>
<li>A call that fails, with an error response, is credited back automatically.</li>
<li>The API key is the only credential for your balance. Keep it secret. You can rotate it at <code>POST /account/key/rotate</code>, and the old key stops working at once. We can restore access to a lost key only when you prove the purchase, for example with the Link receipt.</li>
</ul>
<p><strong>Marketplaces.</strong> When you use ${SERVICE_NAME} through a marketplace such as Apify, that marketplace bills you under its own terms.</p>
<p>Prices per call may change. Changes are published in the documentation before they apply, and credit you already bought keeps its dollar value.</p>

<h2>4. Acceptable use</h2>
<ul>
<li>Use the service lawfully.</li>
<li>You are responsible for what you do with the content you retrieve, including copyright, database rights, the target site's terms, and data-protection law for any personal data in it. For that data, you are the controller.</li>
<li>Do not use the service to attack, overload or gain unauthorised access to any system. Do not bypass access controls or paywalls, collect credentials, or send spam.</li>
<li><code>/crawl</code> honours robots.txt by default.</li>
</ul>
<p>We may refuse, rate-limit or suspend use that breaks these terms or endangers the service. If we close an account for any reason other than your breach of these terms, we refund its unused balance.</p>

<h2>5. Availability</h2>
<p>The service is provided as is, without a service-level commitment. Web content and third-party providers can change or fail, so results may be incomplete. We may change or retire endpoints, giving notice in the documentation where we can.</p>

<h2>6. Liability</h2>
<p>To the extent the law allows, we are not liable for indirect or consequential loss, or for loss of profit or data. Our total liability is limited to what you paid us in the 12 months before the claim. Nothing in these terms limits liability for intent or gross negligence, or any right a consumer has under mandatory law.</p>

<h2>7. Consumers in the EU and UK</h2>
<p>If you buy as a consumer, you keep your mandatory rights. That includes the 14-day right of withdrawal described in <a href="${LEGAL.linkTerms}">Link's terms</a>; see our <a href="${LEGAL.paths.refunds}">refund policy</a>.</p>

<h2>8. Changes</h2>
<p>We may update these terms. The date at the top shows the current version. Using the service after a change means you accept it.</p>

<h2>9. Law</h2>
<p>These terms are governed by Greek law, and the courts of Greece have jurisdiction. If you are a consumer, you keep the protection of the mandatory law of the country where you live.</p>`, { indexable: true }));
}

export function refundsHandler(c: Context<AppEnv>) {
    return c.html(htmlPage("Refund Policy", html`${updated}
<h2>Prepaid credit bought by card</h2>
<ul>
<li>Within <strong>${String(LEGAL.refundWindowDays)} days</strong> of a purchase, we refund its unused credit on request. Email ${mail} with the receipt Link sent you, or the account part of your API key (the 32 characters after <code>wl_live_</code>), never the whole key.</li>
<li>The refund goes back to the card you paid with, through Link. The refunded credit is removed from your balance. If that leaves the account empty, its key is closed.</li>
<li>If you bought as a consumer in the EU or UK, you can also withdraw within 14 days through Link. See <a href="${LEGAL.linkRefunds}">Link's refund page</a>.</li>
<li>A refund that Link or Stripe grants removes the credit in the same way. If part of it was already spent, the key is closed.</li>
<li>If you dispute a card payment with your bank, its credit is removed and the account's key is closed while the dispute stands.</li>
<li>After ${String(LEGAL.refundWindowDays)} days we refund only where the law requires it, or where we close your account for a reason other than your breach of our <a href="${LEGAL.paths.terms}">terms</a>.</li>
</ul>

<h2>Calls that fail</h2>
<p>A call that ends in an error response is credited back to your balance automatically. The response says so in its <code>Credit-Refunded</code> header. Nothing needs to be requested.</p>

<h2>Per-request x402 payments</h2>
<p>A payment is settled on-chain only when the request succeeds. A failed request is not charged. Settled payments are final on-chain. If a successful response was wrong or unusable, email ${mail} with its <code>X-Receipt-Id</code> and we will review it.</p>

<h2>Marketplaces</h2>
<p>Purchases made through a marketplace such as Apify follow that marketplace's refund policy.</p>`, { indexable: true }));
}

export function privacyHandler(c: Context<AppEnv>) {
    const cacheHours = String(CACHE_TTL_SECONDS.max / HOUR_SECONDS);
    const rateLimitHours = String(FREE_TIER.rateLimitWindowSeconds / HOUR_SECONDS);
    const receiptDays = String(RECEIPT_TTL_SECONDS / DAY_SECONDS);
    return c.html(htmlPage("Privacy Policy", html`${updated}
<h2>Controller</h2>
<p>${operatorLine}. Contact: ${mail}.</p>

<h2>What we process, and for how long</h2>
<ul>
<li><strong>Request logs</strong>: IP address, URL, request headers and errors, kept ${String(LEGAL.logRetentionDays)} days to run and secure the service. Production logs a sample of requests, not all of them.</li>
<li><strong>Free-tier rate limiting</strong>: a counter per IP address, deleted after ${rateLimitHours} hour.</li>
<li><strong>Cache</strong>: the parameters of a cacheable request and its result, kept for the time you choose, at most ${cacheHours} hours.</li>
<li><strong>Receipts and feedback</strong>: per-call payment receipts, and feedback documents you post, kept ${receiptDays} days.</li>
<li><strong>Payment events</strong>: for paid calls, the route, amount, network, transaction and payer wallet address, kept ${String(LEGAL.paymentEventRetentionMonths)} months to account for payments and measure reliability. On-chain payments are also public on their blockchain, permanently.</li>
<li><strong>Prepaid accounts</strong>: we keep the following for as long as the account exists, and afterwards for as long as tax law requires:
<ul>
<li>a random account id;</li>
<li>a one-way hash of the API key (never the key itself);</li>
<li>the balance;</li>
<li>a ledger of purchases (Stripe Checkout Session ids) and calls (request ids and amounts).</li>
</ul>
We do not receive your card details. Link and Stripe process your name, email, card and billing address as merchant of record, under <a href="${LEGAL.stripePrivacy}">Stripe's privacy policy</a>.</li>
<li><strong>Content you ask us to fetch</strong>: pages, queries and documents are processed only to answer your request, and cached only as described above.</li>
</ul>
<p>We set no cookies, run no advertising, and do not sell or profile personal data. No decisions about you are made by automated means.</p>

<h2>Legal bases</h2>
<p>We process this data on these bases under the GDPR:</p>
<ul>
<li>performing our contract with you (Art. 6(1)(b));</li>
<li>our legitimate interest in keeping the service secure and free of abuse (Art. 6(1)(f));</li>
<li>our legal obligations, such as keeping tax records (Art. 6(1)(c)).</li>
</ul>

<h2>Who receives data</h2>
<ul>
<li><strong>Cloudflare</strong>: hosting, logs and storage.</li>
<li><strong>Stripe and Link</strong>: card payments.</li>
<li><strong>Coinbase (CDP) and PayAI</strong>: verifying and settling x402 payments.</li>
<li><strong>Anthropic</strong>: the page content and questions sent to AI-backed endpoints.</li>
<li><strong>Serper and SerpAPI</strong>: search queries.</li>
</ul>
<p>Some of these providers are in the United States. Transfers rely on the safeguards they offer: the EU–US Data Privacy Framework or Standard Contractual Clauses.</p>

<h2>Your rights</h2>
<p>You can ask for access to your personal data, or for its correction, erasure, restriction or portability, and you can object to processing. Email ${mail}. You can also complain to the Hellenic Data Protection Authority (<a href="${LEGAL.supervisoryAuthority}">dpa.gr</a>) or to the authority where you live.</p>`, { indexable: true }));
}
