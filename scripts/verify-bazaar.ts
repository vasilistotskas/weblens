/**
 * Verify WebLens Bazaar Listing
 *
 * Two-phase verification:
 * 1. Probe our own production API — trigger 402 challenges, decode PAYMENT-REQUIRED headers,
 *    and confirm Bazaar extension metadata is present on each endpoint.
 * 2. Spot-check the Coinbase Bazaar catalog — paginate with throttling until we find our
 *    resources (by payTo address), then verify coverage.
 *
 * Usage:
 *   npx tsx scripts/verify-bazaar.ts
 *
 * Optional:
 *   API_URL=https://api.weblens.dev npx tsx scripts/verify-bazaar.ts
 *   SKIP_BAZAAR=true npx tsx scripts/verify-bazaar.ts   # Phase 1 only (no Bazaar scan)
 */

// ============================================
// Types
// ============================================

interface PaymentChallenge {
  x402Version: number;
  error: string;
  resource: {
    url: string;
    description: string;
    mimeType: string;
  };
  accepts: {
    scheme: string;
    network: string;
    amount: string;
    asset: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra?: { name?: string; version?: string };
  }[];
  extensions?: {
    bazaar?: {
      info?: Record<string, unknown>;
      schema?: Record<string, unknown>;
    };
  };
}

interface BazaarItem {
  resource?: string;
  type?: string;
  x402Version?: number;
  accepts?: {
    resource?: string;
    payTo?: string;
    network?: string;
    maxAmountRequired?: string;
    asset?: string;
    description?: string;
    outputSchema?: unknown;
  }[];
  lastUpdated?: string;
}

interface BazaarResponse {
  items?: BazaarItem[];
  resources?: BazaarItem[];
  pagination?: { limit: number; offset: number; total: number };
}

// ============================================
// Config
// ============================================

const API_URL = process.env.API_URL ?? "https://api.weblens.dev";
const BAZAAR_ENDPOINT = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";
const SKIP_BAZAAR = process.env.SKIP_BAZAAR === "true";

/**
 * All paid POST endpoints with minimal valid bodies that pass Zod validation
 * so the request reaches the x402 payment middleware and returns 402.
 */
const PAID_ENDPOINTS: { path: string; body: Record<string, unknown> }[] = [
  { path: "/fetch/basic",     body: { url: "https://example.com" } },
  { path: "/fetch/pro",       body: { url: "https://example.com" } },
  { path: "/fetch/resilient", body: { url: "https://example.com" } },
  { path: "/screenshot",      body: { url: "https://example.com" } },
  { path: "/search",          body: { query: "test" } },
  { path: "/extract",         body: { url: "https://example.com", schema: { title: "string" } } },
  { path: "/extract/smart",   body: { url: "https://example.com", query: "test" } },
  { path: "/research",        body: { query: "test" } },
  { path: "/batch/fetch",     body: { urls: ["https://example.com", "https://example.org"] } },
  { path: "/pdf",             body: { url: "https://example.com/doc.pdf" } },
  { path: "/compare",         body: { urls: ["https://example.com", "https://example.org"] } },
  { path: "/monitor/create",  body: { url: "https://example.com", webhookUrl: "https://example.com/hook" } },
  { path: "/memory/set",      body: { key: "test", value: "test" } },
  { path: "/intel/company",   body: { param: "test", target: "test" } },
  { path: "/intel/market",    body: { param: "test", topic: "test" } },
  { path: "/intel/competitive", body: { param: "test", company: "test" } },
  { path: "/intel/site-audit", body: { param: "https://example.com", url: "https://example.com" } },
  { path: "/credits/buy",     body: { amount: 5 } },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================
// Phase 1: Probe our own API for 402 challenges
// ============================================

async function probeEndpoint(path: string, body: Record<string, unknown>): Promise<{
  success: boolean;
  payTo?: string;
  hasBazaar: boolean;
  price?: string;
  error?: string;
}> {
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (response.status !== 402) {
      return { success: false, hasBazaar: false, error: `Expected 402, got ${response.status}` };
    }

    const paymentHeader = response.headers.get("PAYMENT-REQUIRED");
    if (!paymentHeader) {
      return { success: false, hasBazaar: false, error: "No PAYMENT-REQUIRED header" };
    }

    // Decode the base64 challenge — may have trailing padding issues
    const decoded = JSON.parse(Buffer.from(paymentHeader, "base64").toString()) as PaymentChallenge;
    const accept = decoded.accepts[0];
    const hasBazaar = decoded.extensions?.bazaar !== undefined;

    return {
      success: true,
      payTo: accept.payTo,
      hasBazaar,
      price: accept.amount,
    };
  } catch (err) {
    return { success: false, hasBazaar: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function phase1(): Promise<{ payTo: string | undefined; results: { path: string; success: boolean; hasBazaar: boolean; price?: string; error?: string }[] }> {
  console.log("━".repeat(50));
  console.log("📡 Phase 1: Probing production API for 402 challenges");
  console.log("━".repeat(50));
  console.log(`API: ${API_URL}\n`);

  let discoveredPayTo: string | undefined;
  const results: { path: string; success: boolean; hasBazaar: boolean; price?: string; error?: string }[] = [];

  for (const ep of PAID_ENDPOINTS) {
    const result = await probeEndpoint(ep.path, ep.body);
    results.push({ path: ep.path, ...result });

    if (result.success) {
      if (!discoveredPayTo && result.payTo) {
        discoveredPayTo = result.payTo;
      }

      const bazaarTag = result.hasBazaar ? "✅ bazaar" : "⚠️  no bazaar ext";
      console.log(`✅ ${ep.path.padEnd(22)} → 402 OK | ${result.price ?? "?"} atomic | ${bazaarTag}`);
    } else {
      console.log(`❌ ${ep.path.padEnd(22)} → ${result.error}`);
    }

    await sleep(200);
  }

  console.log();
  const successCount = results.filter((r) => r.success).length;
  const bazaarCount = results.filter((r) => r.hasBazaar).length;
  console.log(`Phase 1 results: ${successCount}/${PAID_ENDPOINTS.length} returned 402, ${bazaarCount} with Bazaar extension`);
  if (discoveredPayTo) {
    console.log(`Discovered payTo: ${discoveredPayTo}`);
  }

  return { payTo: discoveredPayTo, results };
}

// ============================================
// Phase 2: Search Bazaar catalog for our payTo
// ============================================

async function fetchBazaarPage(offset: number, retries = 5): Promise<BazaarResponse> {
  const url = `${BAZAAR_ENDPOINT}?limit=100&offset=${offset}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await fetch(url);

    if (response.status === 429) {
      const backoff = 2000 * Math.pow(2, attempt);
      process.stdout.write(` [429 — backoff ${backoff / 1000}s]`);
      await sleep(backoff);
      continue;
    }

    if (!response.ok) {
      throw new Error(`Bazaar API returned ${response.status} ${response.statusText}`);
    }

    const data: BazaarResponse = await response.json();
    return data;
  }

  throw new Error(`Bazaar API rate-limited after ${retries} retries at offset ${offset}`);
}

async function phase2(payTo: string): Promise<BazaarItem[]> {
  console.log("\n" + "━".repeat(50));
  console.log("🔍 Phase 2: Scanning Coinbase Bazaar catalog");
  console.log("━".repeat(50));
  console.log(`Looking for payTo: ${payTo}\n`);

  const weblensItems: BazaarItem[] = [];
  let offset = 0;

  const firstPage = await fetchBazaarPage(0);
  const total = firstPage.pagination?.total ?? 0;
  console.log(`Bazaar total: ${total} resources\n`);

  const firstItems = firstPage.items ?? firstPage.resources ?? [];
  for (const item of firstItems) {
    if (item.accepts?.some((a) => a.payTo === payTo)) {
      weblensItems.push(item);
    }
  }
  offset += firstItems.length;

  while (offset < total) {
    process.stdout.write(`\rScanning... ${offset}/${total} (found ${weblensItems.length})`);
    await sleep(2000);

    try {
      const page = await fetchBazaarPage(offset);
      const items = page.items ?? page.resources ?? [];
      if (items.length === 0) { break; }

      for (const item of items) {
        if (item.accepts?.some((a) => a.payTo === payTo)) {
          weblensItems.push(item);
        }
      }

      offset += items.length;
    } catch (err) {
      // If we're rate-limited after all retries, report what we have so far
      console.log(`\n⚠️  Stopped at offset ${offset}: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
  }

  process.stdout.write(`\rScanned ${offset}/${total} — found ${weblensItems.length} WebLens resources\n`);
  return weblensItems;
}

// ============================================
// Main
// ============================================

async function run(): Promise<void> {
  console.log("🔍 WebLens Bazaar Verification\n");

  // Phase 1 — always runs
  const { payTo, results } = await phase1();

  const phase1Failures = results.filter((r) => !r.success);
  if (phase1Failures.length > 0) {
    console.log(`\n⚠️  ${phase1Failures.length} endpoint(s) did not return 402:`);
    phase1Failures.forEach((r) => { console.log(`   ${r.path}: ${r.error}`); });
  }

  const noBazaar = results.filter((r) => r.success && !r.hasBazaar);
  if (noBazaar.length > 0) {
    console.log(`\n⚠️  ${noBazaar.length} endpoint(s) missing Bazaar extension:`);
    noBazaar.forEach((r) => { console.log(`   ${r.path}`); });
  }

  // Phase 2 — optional Bazaar catalog scan
  if (SKIP_BAZAAR) {
    console.log("\n⏩ Skipping Bazaar catalog scan (SKIP_BAZAAR=true)");
  } else if (!payTo) {
    console.log("\n⏩ Skipping Bazaar catalog scan (no payTo address discovered)");
  } else {
    const bazaarItems = await phase2(payTo);

    if (bazaarItems.length > 0) {
      console.log(`\n✅ Found ${bazaarItems.length} WebLens resources in Bazaar:\n`);

      const foundPaths: string[] = [];
      const missingPaths: string[] = [];

      for (const ep of PAID_ENDPOINTS) {
      const expected = ep.path;
        const found = bazaarItems.some((item) => {
          const url = item.resource ?? item.accepts?.[0]?.resource ?? "";
          return url.includes(expected);
        });
        if (found) {
          foundPaths.push(expected);
        } else {
          missingPaths.push(expected);
        }
      }

      foundPaths.forEach((p) => { console.log(`   ✅ ${p}`); });
      missingPaths.forEach((p) => { console.log(`   ❌ ${p}`); });

      console.log(`\n   Matched: ${foundPaths.length}/${PAID_ENDPOINTS.length}`);
    } else {
      console.log("\n❌ No WebLens resources found in Bazaar catalog.");
      console.log("\n🔧 Troubleshooting:");
      console.log("   1. Ensure CDP_API_KEY_ID and CDP_API_KEY_SECRET are set in production");
      console.log("   2. Deploy your latest changes: pnpm run deploy");
      console.log("   3. Wait 5-10 minutes for Bazaar indexing");
      console.log("   4. The CDP facilitator must verify at least one payment for indexing");
    }
  }

  // Final summary
  console.log("\n" + "━".repeat(50));
  console.log("📊 Final Summary");
  console.log("━".repeat(50));
  const phase1ok = results.filter((r) => r.success).length;
  const bazaarOk = results.filter((r) => r.hasBazaar).length;
  console.log(`   402 challenges:    ${phase1ok}/${PAID_ENDPOINTS.length}`);
  console.log(`   Bazaar extension:  ${bazaarOk}/${PAID_ENDPOINTS.length}`);
  console.log("━".repeat(50) + "\n");
}

run()
  .then(() => {
    console.log("🎉 Verification complete!");
  })
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    throw e;
  });
