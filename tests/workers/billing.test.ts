/// <reference types="@cloudflare/vitest-plugin/types" />
/**
 * Buying a prepaid pack by card, through the real Worker, with Stripe's REST
 * API answered by a spy on fetch. Checks the Checkout Session we ask Stripe
 * for, fulfilment from both the success page and the webhook (once only),
 * the one-time key reveal, and every way a fulfilment is refused.
 */
import { createExecutionContext, SELF, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STRIPE } from "../../src/config";
import { app } from "../../src/index";
import { formatApiKey, newAccountId } from "../../src/services/accounts";
import type { Env } from "../../src/types";

const ORIGIN = "https://api.weblens.dev";
const WEBHOOK_SECRET = "whsec_test_secret";
const stripeEnv: Env = { ...(env as unknown as Env), STRIPE_SECRET_KEY: "sk_test_123", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET };

let ipCounter = 100;
async function call(path: string, init: RequestInit = {}, withStripe = true): Promise<Response> {
    ipCounter += 1;
    const headers = new Headers(init.headers);
    headers.set("cf-connecting-ip", `203.0.113.${String(ipCounter % 250)}`);
    const ctx = createExecutionContext();
    const res = await app.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), withStripe ? stripeEnv : (env as unknown as Env), ctx);
    await waitOnExecutionContext(ctx);
    return res;
}

interface StripeCall { method: string; url: URL; headers: Headers; form: URLSearchParams }
let stripeCalls: StripeCall[] = [];
/** The Checkout Session Stripe returns on retrieve; tests adjust it. */
let session: Record<string, unknown> = {};

function paidSession(accountId: string, sessionId = `cs_test_${newAccountId()}`): Record<string, unknown> {
    return {
        id: sessionId,
        client_reference_id: accountId,
        metadata: { pack: "10" },
        payment_status: "paid",
        line_items: { data: [{ quantity: 1, price: { currency: "usd", unit_amount: 1000 } }] },
    };
}

beforeEach(() => {
    stripeCalls = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (url.host !== "api.stripe.com") { return new Response("unexpected host", { status: 500 }); }
        stripeCalls.push({ method: request.method, url, headers: request.headers, form: new URLSearchParams(await request.text()) });
        if (request.method === "POST" && url.pathname === "/v1/checkout/sessions") {
            return Response.json({ id: "cs_test_created", url: "https://checkout.stripe.com/c/pay/cs_test_created" });
        }
        if (request.method === "GET" && url.pathname.startsWith("/v1/checkout/sessions/")) {
            return Response.json(session);
        }
        return Response.json({ error: { type: "invalid_request_error" } }, { status: 404 });
    });
});
afterEach(() => {
    vi.restoreAllMocks();
});

function checkout(body: unknown, headers: Record<string, string> = {}, withStripe = true) {
    return call("/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }, withStripe);
}

async function signed(payload: string, secret = WEBHOOK_SECRET): Promise<string> {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
    return `t=${timestamp},v1=${Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function webhook(type: string, sessionId: string, signature?: string) {
    const payload = JSON.stringify({ id: "evt_test", type, data: { object: { id: sessionId } } });
    return (async () => call("/billing/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json", "stripe-signature": signature ?? await signed(payload) },
        body: payload,
    }))();
}

describe("POST /billing/checkout", () => {
    it("answers 503 where Stripe is not configured", async () => {
        const res = await checkout({ pack: "10" }, {}, false);
        expect(res.status).toBe(503);
        expect(stripeCalls).toEqual([]);
    });

    it("opens a Managed Payments Checkout for a new account", async () => {
        const res = await checkout({ pack: "50" });
        const body = await res.json<Record<string, unknown>>();

        expect(res.status).toBe(200);
        expect(body).toMatchObject({ checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_created", sessionId: "cs_test_created", pack: "$50" });
        const [created] = stripeCalls;
        expect(created?.headers.get("Stripe-Version")).toBe(STRIPE.apiVersion);
        expect(created?.headers.get("Authorization")).toBe("Bearer sk_test_123");
        expect(Object.fromEntries(created?.form ?? [])).toMatchObject({
            mode: "payment",
            "managed_payments[enabled]": "true",
            "line_items[0][quantity]": "1",
            "line_items[0][price_data][currency]": "usd",
            "line_items[0][price_data][unit_amount]": "5000",
            "line_items[0][price_data][product_data][tax_code]": STRIPE.taxCode,
            "metadata[pack]": "50",
            success_url: `${ORIGIN}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${ORIGIN}/billing/cancel`,
        });
        expect(created?.form.get("client_reference_id")).toMatch(/^[0-9a-f]{32}$/u);
        // Parameters Managed Payments refuses (docs.stripe.com/payments/managed-payments/update-checkout).
        for (const refused of ["automatic_tax[enabled]", "payment_method_types[0]", "invoice_creation[enabled]", "tax_id_collection[enabled]"]) {
            expect(created?.form.has(refused), refused).toBe(false);
        }
    });

    it("tops up the account of the key it is sent with", async () => {
        const accountId = newAccountId();
        const account = stripeEnv.ACCOUNTS.getByName(accountId);
        await account.deposit("cs_test_seed_topup", 1_000_000, "seed");
        const secret = await account.issueFirstKey();
        const res = await checkout({ pack: "10" }, { Authorization: `Bearer ${formatApiKey(stripeEnv.API_KEY_PREFIX, accountId, secret ?? "")}` });

        expect(res.status).toBe(200);
        expect(stripeCalls[0]?.form.get("client_reference_id")).toBe(accountId);
    });

    it("refuses a top-up with a key that is not active", async () => {
        const res = await checkout({ pack: "10" }, { Authorization: `Bearer wl_live_${"0".repeat(32)}_${"A".repeat(43)}` });
        expect(res.status).toBe(401);
        expect(stripeCalls).toEqual([]);
    });

    it("limits checkouts per client, on its own budget rather than the free tier's", async () => {
        const fixedIp = { "cf-connecting-ip": "198.51.100.9" };
        const statuses: number[] = [];
        for (let attempt = 0; attempt < 11; attempt++) {
            const ctx = createExecutionContext();
            const res = await app.fetch(new Request(`${ORIGIN}/billing/checkout`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...fixedIp },
                body: JSON.stringify({ pack: "10" }),
            }), stripeEnv, ctx);
            await waitOnExecutionContext(ctx);
            statuses.push(res.status);
        }
        expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
        expect(statuses[10]).toBe(429);
    });

    it("refuses a pack that is not sold", async () => {
        expect((await checkout({ pack: "5" })).status).toBe(400);
        expect(stripeCalls).toEqual([]);
    });
});

describe("fulfilment", () => {
    it("credits the pack and shows the new account's key once", async () => {
        const accountId = newAccountId();
        session = paidSession(accountId);
        const first = await call(`/billing/success?session_id=${String(session.id)}`);
        const html = await first.text();

        expect(first.status).toBe(200);
        expect(first.headers.get("Cache-Control")).toBe("no-store");
        expect(first.headers.get("Referrer-Policy")).toBe("no-referrer");
        const key = /wl_live_[0-9a-f]{32}_[A-Za-z0-9_-]{43}/u.exec(html)?.[0];
        expect(key?.startsWith(`wl_live_${accountId}_`)).toBe(true);
        expect(html).toContain("$10");
        expect(stripeCalls[0]?.url.searchParams.get("expand[]")).toBe("line_items");

        // Reloading the page, or the webhook arriving later, adds nothing and shows no key.
        const again = await call(`/billing/success?session_id=${String(session.id)}`);
        expect(await again.text()).not.toMatch(/wl_live_[0-9a-f]{32}_/u);
        expect((await webhook("checkout.session.completed", String(session.id))).status).toBe(200);

        const account = await SELF.fetch(`${ORIGIN}/account`, { headers: { Authorization: `Bearer ${key ?? ""}` } });
        expect(await account.json()).toMatchObject({ balance: "$10" });
    });

    it("fulfils from the webhook when the buyer never returns", async () => {
        const accountId = newAccountId();
        session = paidSession(accountId);
        const res = await webhook("checkout.session.async_payment_succeeded", String(session.id));

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ status: "credited" });
        // The key is still shown when the buyer does come back.
        const page = await (await call(`/billing/success?session_id=${String(session.id)}`)).text();
        expect(page).toMatch(new RegExp(`wl_live_${accountId}_`, "u"));
    });

    it("credits nothing for an unpaid session", async () => {
        session = { ...paidSession(newAccountId()), payment_status: "unpaid" };
        expect((await call(`/billing/success?session_id=${String(session.id)}`)).status).toBe(202);
        expect(await (await webhook("checkout.session.completed", String(session.id))).json()).toMatchObject({ status: "unpaid" });
    });

    it.each([
        ["no account", { client_reference_id: null }],
        ["an unknown pack", { metadata: { pack: "7" } }],
        ["a price that is not the pack's", { line_items: { data: [{ quantity: 1, price: { currency: "usd", unit_amount: 1 } }] } }],
        ["another currency", { line_items: { data: [{ quantity: 1, price: { currency: "eur", unit_amount: 1000 } }] } }],
        ["two packs", { line_items: { data: [{ quantity: 2, price: { currency: "usd", unit_amount: 1000 } }] } }],
    ])("acknowledges but never credits a session with %s", async (_label, change) => {
        session = { ...paidSession(newAccountId()), ...change };
        const res = await webhook("checkout.session.completed", String(session.id));
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ ignored: "not a WebLens credit pack" });
        expect((await call(`/billing/success?session_id=${String(session.id)}`)).status).toBe(400);
    });

    it("rejects a webhook with a bad signature", async () => {
        const res = await webhook("checkout.session.completed", "cs_test_forged", await signed("{}", "whsec_wrong"));
        expect(res.status).toBe(400);
        expect(stripeCalls).toEqual([]);
    });

    it("acknowledges events it does not act on", async () => {
        const res = await webhook("payment_intent.created", "pi_test_1");
        expect(await res.json()).toMatchObject({ ignored: "payment_intent.created" });
        expect(stripeCalls).toEqual([]);
    });

    it("refuses a success link that names no Checkout Session", async () => {
        expect((await call("/billing/success?session_id=<script>")).status).toBe(400);
        expect(stripeCalls).toEqual([]);
    });
});
