import { createFacilitatorConfig } from "@coinbase/x402";
import type { FacilitatorConfig } from "@x402/core/http";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { RoutesConfig } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { paymentMiddleware } from "@x402/hono";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import type { Context, MiddlewareHandler } from "hono";
import { evmNetwork, FACILITATOR_URLS, SERVICE_ICON_PATH, SERVICE_NAME, svmNetwork } from "../config";
import type { JsonObjectSchema } from "../endpoints/define";
import { FacilitatorChain, parseFacilitatorOrder } from "../services/facilitator-chain";
import type { NetworkFamily } from "../services/facilitator-chain";
import { payaiAuthHeaders } from "../services/payai-auth";
import {
    classifyPaymentRequest,
    emitPaymentEvent,
    noteCanceled,
    noteSettled,
    noteSettleFailure,
    noteVerifyError,
    noteVerifyResult,
    runPaymentAttempt,
    TrackedFacilitatorClient,
} from "../services/payment-telemetry";
import type { FacilitatorLabel } from "../services/payment-telemetry";
import type { AppEnv, Env } from "../types";
import { createLogger } from "../utils/logger";

// Module-level logger for init-time wiring and facilitator hooks, which run
// outside any request context (no Hono `c` available). Per-request price logs
// use the request-scoped logger via `c.get("log")`.
const log = createLogger();

// ============================================
// Resource Server Cache (env-signature keyed)
// ============================================
//
// We cache one x402ResourceServer per distinct env signature so a secret
// rotation or network change invalidates the cache *immediately* on the next
// request, instead of waiting for the Worker isolate to evict. The signature
// includes every env field that influences facilitator wiring — including a
// short fingerprint of the CDP secret so rotating only the secret (without
// the key id) still invalidates the cache.
const resourceServerCache = new Map<string, x402ResourceServer>();

/** Short non-cryptographic fingerprint of a string, used only for cache keys. */
function fingerprint(value: string | undefined): string {
    if (!value) {return "";}
    let h = 5381;
    for (let i = 0; i < value.length; i++) {
        h = ((h << 5) + h) ^ value.charCodeAt(i);
    }
    return (h >>> 0).toString(16);
}

/**
 * Absolute catalog icon URL for the origin serving this request.
 *
 * Forced to https for any non-local host: facilitator curation checks that
 * published metadata is https, and `wrangler dev` reports the *configured
 * route* host over plain http (`http://api.weblens.dev/...`), so deriving the
 * scheme straight from the request would publish an http icon.
 */
export function catalogIconUrl(requestUrl: string): string {
    const url = new URL(SERVICE_ICON_PATH, requestUrl);
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (!isLocal) {
        url.protocol = "https:";
    }
    return url.toString();
}

function envSignature(env: Env): string {
    return [
        env.NETWORK ?? "base",
        env.CDP_API_KEY_ID ?? "",
        fingerprint(env.CDP_API_KEY_SECRET),
        env.FACILITATOR_URL ?? "",
        env.PAYAI_FACILITATOR_URL ?? "",
        env.PAYAI_API_KEY_ID ?? "",
        fingerprint(env.PAYAI_API_KEY_SECRET),
        env.FACILITATORS_EVM ?? "",
        env.FACILITATORS_SVM ?? "",
        // Decides whether the SVM scheme is registered at all, so turning
        // Solana on or off must rebuild the server rather than wait for the
        // isolate to be recycled.
        env.PAY_TO_ADDRESS_SVM ?? "",
    ].join("|");
}

/** One facilitator the payment wall talks to, named for telemetry and /health. */
export interface FacilitatorEntry {
    label: FacilitatorLabel;
    client: HTTPFacilitatorClient;
}

/**
 * PayAI's client config. The API key is attached only when both halves are
 * set: PayAI rejects a bad credential rather than downgrading to anonymous,
 * so half a key would fail every payment instead of degrading.
 */
function payaiConfig(env: Env): FacilitatorConfig {
    const url = env.PAYAI_FACILITATOR_URL ?? FACILITATOR_URLS.payai;
    if (env.PAYAI_API_KEY_ID && env.PAYAI_API_KEY_SECRET) {
        return { url, createAuthHeaders: payaiAuthHeaders(env.PAYAI_API_KEY_ID, env.PAYAI_API_KEY_SECRET) };
    }
    return { url };
}

/** The facilitators one network family settles through, in the order they are tried. */
export interface FacilitatorPlan {
    family: NetworkFamily;
    facilitators: [FacilitatorEntry, ...FacilitatorEntry[]];
    /** Configured facilitators left out because their credentials are not set. */
    skipped: FacilitatorLabel[];
}

/** A facilitator's client, or undefined when this env lacks the credentials it needs (only CDP needs any). */
function facilitatorEntry(env: Env, label: FacilitatorLabel): FacilitatorEntry | undefined {
    switch (label) {
        case "payai":
            return { label, client: new HTTPFacilitatorClient(payaiConfig(env)) };
        case "cdp":
            return env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET
                ? { label, client: new HTTPFacilitatorClient(createFacilitatorConfig(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET)) }
                : undefined;
        case "x402.org":
            return { label, client: new HTTPFacilitatorClient({ url: env.FACILITATOR_URL ?? FACILITATOR_URLS.testnet }) };
    }
}

/**
 * The facilitators each network family settles through, from config:
 * `FACILITATORS_EVM` always, `FACILITATORS_SVM` when Solana is live (see
 * svmNetwork). Production tries CDP first on Base: the CDP Bazaar indexes and
 * ranks a route only by payments the CDP facilitator settled, and CDP carries
 * most x402 buyers. PayAI takes over a Base payment CDP fails on (CDP's Base
 * /settle has failed intermittently, coinbase/x402#1065). Solana stays on
 * PayAI alone: its fee payer is part of the quote (FacilitatorChain).
 *
 * A configured facilitator whose credentials are missing (CDP without its
 * keys, as in CI and on keyless dev machines) is skipped rather than fatal:
 * a lost secret must not stop payments another facilitator can settle.
 * getResourceServer() logs the skip; a family left with none throws.
 */
export function facilitatorPlans(env: Env): FacilitatorPlan[] {
    const plan = (family: NetworkFamily, order: string | undefined): FacilitatorPlan => {
        const configured = parseFacilitatorOrder(family, order);
        const usable: FacilitatorEntry[] = [];
        const skipped: FacilitatorLabel[] = [];
        for (const label of configured) {
            const entry = facilitatorEntry(env, label);
            if (entry) { usable.push(entry); } else { skipped.push(label); }
        }
        const [first, ...rest] = usable;
        if (!first) {
            throw new Error(`No ${family} facilitator is usable: ${configured.join(", ")} configured, credentials missing for ${skipped.join(", ")}`);
        }
        return { family, facilitators: [first, ...rest], skipped };
    };
    return [
        plan("eip155", env.FACILITATORS_EVM),
        ...(svmNetwork(env) ? [plan("solana", env.FACILITATORS_SVM)] : []),
    ];
}

/** Every facilitator in use, once each, in the order the plans first try them. */
export function distinctFacilitators(plans: readonly FacilitatorPlan[]): FacilitatorEntry[] {
    const seen = new Map<FacilitatorLabel, FacilitatorEntry>();
    for (const entry of plans.flatMap((plan) => plan.facilitators)) {
        if (!seen.has(entry.label)) { seen.set(entry.label, entry); }
    }
    return [...seen.values()];
}

/** The facilitators as discovery documents name them, joined by "+", e.g. "cdp+payai". */
export function facilitatorNames(env: Env): string {
    return distinctFacilitators(facilitatorPlans(env)).map(({ label }) => label).join("+");
}

/**
 * Get or create the x402 resource server for the given env. Cached per env
 * signature so the cost of `httpServer.initialize()` (one network call to
 * `/supported`) is paid once per distinct facilitator config, not per request.
 */
function getResourceServer(env: Env): x402ResourceServer {
    const key = envSignature(env);
    const cached = resourceServerCache.get(key);
    if (cached) {return cached;}

    log.info("x402.init_start");

    // CAIP-2 network identifiers. `svmCaip2` is undefined unless a Solana
    // payout address is configured — see svmNetwork() in config.ts.
    const evmCaip2 = evmNetwork(env);
    const svmCaip2 = svmNetwork(env);

    // One chain per network family. Each facilitator is wrapped so the payment
    // telemetry records which one verified/settled a given request.
    const plans = facilitatorPlans(env);
    const tracked = ({ label, client }: FacilitatorEntry) => new TrackedFacilitatorClient(label, client);
    const server = new x402ResourceServer(plans.map(({ family, facilitators: [first, ...rest] }) =>
        new FacilitatorChain(family, [tracked(first), ...rest.map(tracked)], log)));
    server.register(evmCaip2, new ExactEvmScheme());
    // Solana settles a plain SPL TransferChecked, with transaction fees paid
    // by a facilitator-sponsored feePayer that arrives in the supported-kind
    // `extra` (PayAI advertises one for both Solana networks), so this needs
    // no SOL and no Solana RPC of our own. Only register it when a payout
    // address is configured: registering a network the facilitator does not
    // advertise leaves initialize() with no supported kind for it, and
    // buildPaymentRequirements then throws for every request on the route.
    if (svmCaip2) {
        server.register(svmCaip2, new ExactSvmScheme());
    }
    server.registerExtension(bazaarResourceServerExtension);

    // Lifecycle hooks record into the request's PaymentAttempt; the payment
    // middleware turns it into exactly one funnel event per request. A
    // facilitator rejection (HTTP 200, isValid:false) never reaches
    // onVerifyFailure — it arrives as a normal verify result — so onAfterVerify
    // is what makes rejected payments visible. The signatures require a
    // Promise, so each hook returns a resolved one without awaiting anything.
    server.onAfterVerify((ctx) => {
        noteVerifyResult(ctx.requirements, ctx.result);
        return Promise.resolve();
    });
    server.onVerifyFailure((ctx) => {
        noteVerifyError(ctx.requirements, ctx.error);
        return Promise.resolve();
    });
    server.onAfterSettle((ctx) => {
        // A "cancel"-phase settle is a refund, not a sale.
        if (ctx.phase !== "cancel") {
            noteSettled(ctx.requirements, ctx.result);
        }
        return Promise.resolve();
    });
    server.onSettleFailure((ctx) => {
        noteSettleFailure(ctx.requirements, ctx.error);
        return Promise.resolve();
    });
    server.onVerifiedPaymentCanceled((ctx) => {
        noteCanceled(ctx.requirements, ctx.reason, ctx.responseStatus);
        return Promise.resolve();
    });

    resourceServerCache.set(key, server);

    for (const { family, skipped } of plans) {
        if (skipped.length > 0) {
            log.warn("x402.facilitator_skipped", { family, skipped: skipped.join(", "), reason: "credentials not set" });
        }
    }

    log.info("x402.init_ready", {
        network: evmCaip2,
        svmNetwork: svmCaip2 ?? "disabled",
        // Order tried per family, e.g. "eip155: cdp > payai; solana: payai".
        facilitators: plans.map(({ family, facilitators }) => `${family}: ${facilitators.map(({ label }) => label).join(" > ")}`).join("; "),
        payaiApiKey: Boolean(env.PAYAI_API_KEY_ID && env.PAYAI_API_KEY_SECRET),
    });

    return server;
}

// ============================================
// Configuration Helpers
// ============================================

/** What the payment wall advertises for one paid route (built from its registry definition). */
export interface PaymentRoute {
    path: string;
    description: string;
    catalogTags: readonly string[];
    evmOnly: boolean;
    inputExample: Record<string, unknown>;
    /** JSON Schema of the request body. */
    inputSchema: Record<string, unknown>;
    outputExample: Record<string, unknown>;
    outputSchema: JsonObjectSchema;
}

/**
 * Build a RoutesConfig object for x402 payment middleware, with the Bazaar
 * discovery extension describing the route's input and output.
 */
function createPaymentConfig(
    route: PaymentRoute,
    price: string,
    destinationAddress: string,
    networkCaip2: string,
    /** Second payment option. Omitted when Solana is not configured. */
    svmTarget: { network: string; payTo: string } | undefined,
    catalog: { serviceName: string; tags: string[]; iconUrl?: string }
): RoutesConfig {
    const extensionConfig = {
        bodyType: "json" as const,
        input: route.inputExample,
        inputSchema: route.inputSchema,
        output: {
            example: route.outputExample,
            schema: { ...route.outputSchema },
        },
    };
    const { path, description } = route;

    return {
        // Route keys are method-prefixed per x402 v2 spec ("POST /path") so
        // facilitator-side Bazaar indexing stores entries under the right
        // resource tuple. All weblens paid endpoints are POST-only.
        [`POST ${path}`]: {
            // One entry per network we can actually be paid on. Buyers pick;
            // the price string is identical, and each scheme converts it to
            // that chain's USDC atomic units through its own parsePrice.
            accepts: [
                {
                    scheme: "exact" as const,
                    price,
                    network: networkCaip2,
                    payTo: destinationAddress,
                },
                ...(svmTarget
                    ? [{
                        scheme: "exact" as const,
                        price,
                        network: svmTarget.network,
                        payTo: svmTarget.payTo,
                    }]
                    : []),
            ],
            description,
            mimeType: "application/json" as const,
            // These three are RouteConfig fields, deliberately outside
            // `extensions` — see SERVICE_NAME in config.ts for why that
            // distinction is load-bearing.
            serviceName: catalog.serviceName,
            tags: catalog.tags,
            ...(catalog.iconUrl ? { iconUrl: catalog.iconUrl } : {}),
            extensions: {
                ...declareDiscoveryExtension(extensionConfig),
            },
        }
    } as RoutesConfig;
}

// ============================================
// Middleware Factory
// ============================================

// Per-route middleware cache, keyed on (path + price + payTo + network + cdpKeyId).
// When env changes the cache key changes, so the middleware is rebuilt
// automatically — no stale `payTo` after a config change.
const middlewareCache = new Map<string, MiddlewareHandler<AppEnv>>();

/**
 * Drop every cached payment object for this env.
 *
 * Called when the payment wall fails before the handler runs. Clearing the
 * whole middleware cache — not just the failing route — is deliberate: each
 * cached middleware closes over the resource server we are evicting *and* over
 * its own latched `isInitialized` flag, so every one of them is poisoned by
 * the same bad `/supported` sync. Evicting only the failing route would leave
 * each remaining route to serve one 5xx of its own before healing.
 */
function evictPaymentCaches(env: Env): void {
    resourceServerCache.delete(envSignature(env));
    middlewareCache.clear();
}

/**
 * Create a lazy-initialized x402 payment middleware for one paid route.
 * `priceOrCalculator` is the route's fixed price or its resolver, shared with
 * the credit debit so the two can never charge different amounts. Skips
 * payment if the request was already paid via a credit account.
 */
export function createLazyPaymentMiddleware(
    route: PaymentRoute,
    priceOrCalculator: string | ((c: Context<AppEnv>) => Promise<string>),
): MiddlewareHandler<AppEnv> {
    const { path } = route;
    return async (c, next) => {
        // If already paid with credits, skip x402 entirely.
        if (c.get("paidWithCredits")) {
            await next();
            return;
        }

        const env = c.env;
        const recipientAddress = env.PAY_TO_ADDRESS;
        const networkCaip2 = evmNetwork(env);
        const svmCaip2 = route.evmOnly ? undefined : svmNetwork(env);
        const svmTarget = svmCaip2 && env.PAY_TO_ADDRESS_SVM
            ? { network: svmCaip2, payTo: env.PAY_TO_ADDRESS_SVM }
            : undefined;

        const isStatic = typeof priceOrCalculator === "string";
        const price = isStatic ? priceOrCalculator : await priceOrCalculator(c);

        // Catalog metadata. iconUrl tracks the serving origin so testnet and
        // production each advertise their own reachable icon.
        const catalog = {
            serviceName: SERVICE_NAME,
            tags: [...route.catalogTags],
            iconUrl: catalogIconUrl(c.req.url),
        };

        // Static pricing → cacheable. Dynamic pricing recomputes per request
        // so the middleware instance is rebuilt each time (cheap; the
        // expensive `/supported` init lives on the cached resourceServer).
        // The cache key carries the env signature (credentials and facilitator
        // order), so a rotation or reorder rebuilds the middleware.
        const cacheKey = isStatic
            ? [
                path,
                price,
                recipientAddress,
                networkCaip2,
                // The advertised accepts list changes with this, so a stale
                // entry would keep offering (or withholding) Solana.
                svmTarget ? `${svmTarget.network}|${svmTarget.payTo}` : "",
                envSignature(env),
                catalog.iconUrl,
            ].join("|")
            : null;

        const build = (): MiddlewareHandler<AppEnv> => {
            const config = createPaymentConfig(
                route,
                price,
                recipientAddress,
                networkCaip2,
                svmTarget,
                catalog
            );
            return paymentMiddleware(config, getResourceServer(env)) as MiddlewareHandler<AppEnv>;
        };

        let middleware = cacheKey ? middlewareCache.get(cacheKey) : undefined;
        if (!middleware) {
            middleware = build();
            if (cacheKey) {
                middlewareCache.set(cacheKey, middleware);
                c.get("log").debug("payment.middleware_ready", { path, price });
            } else {
                c.get("log").debug("pricing.dynamic", { path, price });
            }
        }

        // Run the wall, tracking whether control ever reached the handler.
        // @x402/hono answers its own failures (500 internal, 502 facilitator)
        // by returning a Response *without* calling next(), so "handler never
        // ran AND status is 5xx" cleanly separates a payment-wall failure from
        // a handler that ran and failed on its own.
        const run = async (mw: MiddlewareHandler<AppEnv>) => {
            // Held on an object, not a `let`: TypeScript does not track
            // assignments made inside a callback, so a plain local would stay
            // narrowed to its `false` initializer and make the check below a
            // constant. Property narrowing is invalidated by the call.
            const state = { reachedHandler: false };
            // A Hono middleware may answer with a Response or return nothing
            // and leave the answer on `c.res`; the declared type collapses the
            // second case to `void`, so widen it and read whichever applies.
            const response = (await mw(c, async () => {
                state.reachedHandler = true;
                await next();
            })) as Response | undefined;
            const status = response?.status ?? c.res.status;
            return { response, wallFailed: !state.reachedHandler && status >= 500 };
        };

        const paymentSignature = c.req.header("payment-signature");
        const v1Payment = c.req.header("x-payment");

        const payThroughWall = async (): Promise<{ response: Response | undefined; wallUnavailable: boolean }> => {
            const first = await run(middleware);
            if (!first.wallFailed) {
                return { response: first.response, wallUnavailable: false };
            }

            // The wall failed before the handler. The cause we actually see in
            // production is a facilitator whose /supported response omitted our
            // scheme/network: `initialize()` then resolves "successfully" with no
            // supported kind, @x402/hono latches `isInitialized = true` for the
            // life of that closure, and every later request throws out of
            // buildPaymentRequirements. A momentary facilitator blip therefore
            // poisons the isolate until it is recycled, turning 402 challenges
            // into 500s. Drop the caches so the next request re-syncs /supported.
            evictPaymentCaches(env);
            c.get("log").warn("x402.wall_failure", { path, price });

            // Retry once only when no payment was attached. Re-running the wall
            // re-runs verification, and re-verifying a payment that may already
            // have settled risks charging twice; building a bare 402 challenge
            // moves no money, so retrying that is free.
            if (!paymentSignature && !v1Payment) {
                const retry = await run(build());
                if (!retry.wallFailed) {
                    return { response: retry.response, wallUnavailable: false };
                }
            }

            // Still failing: answer in the standard envelope. @x402/hono's own
            // body is `{"error":"Internal Server Error"}`, which carries no code
            // and no requestId, and 500 tells a caller nothing useful — this is a
            // transient upstream condition, so 503 + retryAfter is the honest code.
            const unavailable = c.json(
                {
                    error: "SERVICE_UNAVAILABLE",
                    code: "SERVICE_UNAVAILABLE",
                    message:
                        "The payment facilitator is not currently advertising support for this network, so a payment challenge could not be issued. Retry shortly.",
                    requestId: c.get("requestId"),
                    retryAfter: 5,
                },
                503
            );
            return { response: unavailable, wallUnavailable: true };
        };

        // Run the wall inside a payment-attempt scope so the x402 hooks can
        // record what happened, then emit exactly one funnel event.
        const startedAt = Date.now();
        const { result: outcome, attempt } = await runPaymentAttempt(payThroughWall);
        const final = outcome.response ?? c.res;
        emitPaymentEvent(env.PAYMENT_EVENTS, c.get("log"), classifyPaymentRequest({
            route: path,
            requestId: c.get("requestId"),
            status: final.status,
            paymentSignature,
            v1Payment,
            paymentRequired: final.headers.get("PAYMENT-REQUIRED"),
            paymentResponse: final.headers.get("PAYMENT-RESPONSE"),
            wallUnavailable: outcome.wallUnavailable,
            latencyMs: Date.now() - startedAt,
        }, attempt));
        return outcome.response;
    };
}
