import { createFacilitatorConfig } from "@coinbase/x402";
import {
    x402ResourceServer,
    HTTPFacilitatorClient
    
} from "@x402/core/server";
import type {RoutesConfig} from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { paymentMiddleware } from "@x402/hono";
import type { Context, MiddlewareHandler } from "hono";
import { SERVICE_ICON_PATH, SERVICE_NAME, tagsForPath } from "../config";
import type { Env, Variables } from "../types";
import { createLogger } from "../utils/logger";

// Module-level logger for init-time wiring and facilitator hooks, which run
// outside any request context (no Hono `c` available). Per-request price logs
// use the request-scoped logger via `c.get("log")`.
const log = createLogger();

interface AppEnv {
    Bindings: Env;
    Variables: Variables;
}

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

/**
 * Constant-time string compare. Used for the bootstrap header so a wrong
 * secret cannot be recovered by timing the 402 path.
 */
function secretsMatch(a: string, b: string): boolean {
    if (a.length !== b.length) {return false;}
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

/**
 * True when this request asked to settle through the CDP facilitator instead
 * of PayAI. Fails closed: with no `BAZAAR_BOOTSTRAP_SECRET` configured the
 * header is ignored entirely, so the CDP-primary path cannot be reached from
 * the internet. Used only to seed CDP Bazaar listings (see getResourceServer).
 */
export function wantsCdpBootstrap(env: Env, header: string | undefined): boolean {
    const secret = env.BAZAAR_BOOTSTRAP_SECRET;
    if (!secret || !header) {return false;}
    return secretsMatch(header, secret);
}

function envSignature(env: Env): string {
    return [
        env.NETWORK ?? "base",
        env.CDP_API_KEY_ID ?? "",
        fingerprint(env.CDP_API_KEY_SECRET),
        env.FACILITATOR_URL ?? "",
        env.PAYAI_FACILITATOR_URL ?? "",
    ].join("|");
}

/**
 * Get or create the x402 resource server for the given env. Cached per env
 * signature so the cost of `httpServer.initialize()` (one network call to
 * `/supported`) is paid once per distinct facilitator config, not per request.
 */
function getResourceServer(env: Env, preferCdp = false): x402ResourceServer {
    const key = preferCdp ? `${envSignature(env)}|cdp-primary` : envSignature(env);
    const cached = resourceServerCache.get(key);
    if (cached) {return cached;}

    log.info("x402.init_start");

    // CAIP-2 network identifier. Base mainnet = eip155:8453, Base Sepolia = eip155:84532.
    const NETWORK_CAIP2 = env.NETWORK === "base-sepolia" ? "eip155:84532" : "eip155:8453";

    // Facilitator selection (runtime, not config-driven):
    //   - testnet env or explicit x402.org URL → x402.org facilitator (single)
    //   - CDP keys present → [PayAI primary, CDP secondary] for redundancy
    //     CDP facilitator has known gas-estimation bugs on Base mainnet
    //     (coinbase/x402#1065) with ~40% failure rate. PayAI is more reliable
    //     for the "exact" scheme. CDP is kept as fallback for any schemes
    //     PayAI doesn't advertise via /supported.
    //   - otherwise → PayAI only
    let facilitatorClients: HTTPFacilitatorClient[];
    let facilitatorLabel: string;

    if (env.NETWORK === "base-sepolia" || env.FACILITATOR_URL?.includes("x402.org")) {
        const url = env.FACILITATOR_URL ?? "https://x402.org/facilitator";
        facilitatorClients = [new HTTPFacilitatorClient({ url })];
        facilitatorLabel = `testnet (${url})`;
    } else if (env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET) {
        const payaiUrl = env.PAYAI_FACILITATOR_URL ?? "https://facilitator.payai.network";
        const payaiClient = new HTTPFacilitatorClient({ url: payaiUrl });
        const cdpClient = new HTTPFacilitatorClient(
            createFacilitatorConfig(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET)
        );
        // PayAI first = gets precedence for shared scheme/network combos.
        // x402ResourceServer uses "earlier facilitator wins" during initialize().
        //
        // `preferCdp` inverts that for one request only (see the bootstrap
        // header in createLazyPaymentMiddleware). CDP's Bazaar indexes a
        // resource only after the CDP facilitator itself settles a payment for
        // it, and indexing is per-resource — so a listing can only be seeded by
        // routing a real payment through CDP. Doing that globally would expose
        // every buyer to coinbase/x402#1065, hence per-request opt-in.
        facilitatorClients = preferCdp ? [cdpClient, payaiClient] : [payaiClient, cdpClient];
        facilitatorLabel = preferCdp
            ? `cdp (primary, bootstrap) + payai (fallback)`
            : `payai (primary) + cdp (fallback)`;
    } else {
        const url = env.PAYAI_FACILITATOR_URL ?? "https://facilitator.payai.network";
        facilitatorClients = [new HTTPFacilitatorClient({ url })];
        facilitatorLabel = `payai (${url})`;
    }

    const server = new x402ResourceServer(facilitatorClients);
    server.register(NETWORK_CAIP2, new ExactEvmScheme());
    server.registerExtension(bazaarResourceServerExtension);

    // Visibility hooks: without these, every verify or settle failure returns
    // a generic 402 with no log line. Hook context contains paymentPayload,
    // requirements, and error.
    // The hook signatures require Promise<void | { recovered, result }>, so
    // these intentionally return a resolved promise without awaiting anything.
    server.onVerifyFailure((ctx) => {
        const payload = ctx.paymentPayload as { scheme?: string; network?: string } | undefined;
        const reqs = ctx.requirements as { payTo?: string; amount?: string } | undefined;
        log.error("x402.verify_failure", {
            scheme: payload?.scheme,
            network: payload?.network,
            payTo: reqs?.payTo,
            amount: reqs?.amount,
            error: ctx.error.message,
        });
        return Promise.resolve();
    });
    server.onSettleFailure((ctx) => {
        const payload = ctx.paymentPayload as { scheme?: string; network?: string } | undefined;
        const reqs = ctx.requirements as { payTo?: string; amount?: string } | undefined;
        log.error("x402.settle_failure", {
            scheme: payload?.scheme,
            network: payload?.network,
            payTo: reqs?.payTo,
            amount: reqs?.amount,
            error: ctx.error.message,
        });
        return Promise.resolve();
    });

    resourceServerCache.set(key, server);

    log.info("x402.init_ready", {
        network: NETWORK_CAIP2,
        facilitator: facilitatorLabel,
    });

    return server;
}

// ============================================
// Configuration Helpers
// ============================================

/**
 * Build a RoutesConfig object for x402 payment middleware.
 * Includes Bazaar discovery extensions when input/output schemas are provided.
 */
function createPaymentConfig(
    path: string,
    price: string,
    destinationAddress: string,
    networkCaip2: string,
    description: string,
    inputExample?: Record<string, unknown>,
    inputSchema?: Record<string, unknown>,
    outputExample?: Record<string, unknown>,
    outputSchema?: Record<string, unknown>,
    catalog?: { serviceName: string; tags: string[]; iconUrl?: string }
): RoutesConfig {
    const extensionConfig: Record<string, unknown> = {
        bodyType: "json" as const,
    };

    if (inputExample) {
        extensionConfig.input = inputExample;
    }
    if (inputSchema) {
        extensionConfig.inputSchema = inputSchema;
    }
    if (outputExample && outputSchema) {
        extensionConfig.output = {
            example: outputExample,
            schema: outputSchema,
        };
    }

    return {
        // Route keys are method-prefixed per x402 v2 spec ("POST /path") so
        // facilitator-side Bazaar indexing stores entries under the right
        // resource tuple. All weblens paid endpoints are POST-only.
        [`POST ${path}`]: {
            accepts: [{
                scheme: "exact" as const,
                price,
                network: networkCaip2,
                payTo: destinationAddress,
            }],
            description,
            mimeType: "application/json" as const,
            // These three are RouteConfig fields, deliberately outside
            // `extensions` — see SERVICE_NAME in config.ts for why that
            // distinction is load-bearing.
            ...(catalog
                ? {
                    serviceName: catalog.serviceName,
                    tags: catalog.tags,
                    ...(catalog.iconUrl ? { iconUrl: catalog.iconUrl } : {}),
                }
                : {}),
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
 * Create a lazy-initialized x402 payment middleware. Supports both static
 * prices and dynamic price calculators. Skips payment if the request was
 * already paid via a credit account.
 */
export function createLazyPaymentMiddleware(
    path: string,
    priceOrCalculator: string | ((c: Context<{ Bindings: Env; Variables: Variables }>) => Promise<string>),
    description: string,
    inputExample?: Record<string, unknown>,
    inputSchema?: Record<string, unknown>,
    outputExample?: Record<string, unknown>,
    outputSchema?: Record<string, unknown>
): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
    return async (c, next) => {
        // If already paid with credits, skip x402 entirely.
        if (c.get("paidWithCredits")) {
            await next();
            return;
        }

        const env = c.env;
        const recipientAddress = env.PAY_TO_ADDRESS;
        const networkCaip2 = env.NETWORK === "base-sepolia" ? "eip155:84532" : "eip155:8453";

        const isStatic = typeof priceOrCalculator === "string";
        const price = isStatic ? priceOrCalculator : await priceOrCalculator(c);

        // Opt-in, per-request CDP settlement for seeding Bazaar listings.
        const preferCdp = wantsCdpBootstrap(env, c.req.header("X-Bazaar-Bootstrap"));
        if (preferCdp) {
            c.get("log").info("x402.bootstrap_facilitator", { path, facilitator: "cdp" });
        }

        // Catalog metadata. iconUrl tracks the serving origin so testnet and
        // production each advertise their own reachable icon.
        const catalog = {
            serviceName: SERVICE_NAME,
            tags: tagsForPath(path),
            iconUrl: catalogIconUrl(c.req.url),
        };

        // Static pricing → cacheable. Dynamic pricing recomputes per request
        // so the middleware instance is rebuilt each time (cheap; the
        // expensive `/supported` init lives on the cached resourceServer).
        // The cache key includes a fingerprint of the CDP secret so a secret
        // rotation invalidates the cache even if the key ID stays the same.
        const cacheKey = isStatic
            ? [
                path,
                price,
                recipientAddress,
                networkCaip2,
                env.CDP_API_KEY_ID ?? "",
                fingerprint(env.CDP_API_KEY_SECRET),
                // A bootstrap request must not populate (or read) the cache
                // entry the normal PayAI-primary path uses.
                preferCdp ? "cdp-primary" : "",
                catalog.iconUrl,
            ].join("|")
            : null;

        const build = (): MiddlewareHandler<AppEnv> => {
            const config = createPaymentConfig(
                path,
                price,
                recipientAddress,
                networkCaip2,
                description,
                inputExample,
                inputSchema,
                outputExample,
                outputSchema,
                catalog
            );
            return paymentMiddleware(config, getResourceServer(env, preferCdp)) as MiddlewareHandler<AppEnv>;
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

        const first = await run(middleware);
        if (!first.wallFailed) {
            return first.response;
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
        c.get("log").error("x402.wall_failure", { path, price });

        // Retry once only when no payment was attached. Re-running the wall
        // re-runs verification, and re-verifying a payment that may already
        // have settled risks charging twice; building a bare 402 challenge
        // moves no money, so retrying that is free — and with zero payment
        // attempts in production, that is every failure observed here.
        const paymentAttached = Boolean(
            c.req.header("payment-signature") ?? c.req.header("x-payment")
        );
        if (!paymentAttached) {
            const retry = await run(build());
            if (!retry.wallFailed) {
                return retry.response;
            }
        }

        // Still failing: answer in the standard envelope. @x402/hono's own
        // body is `{"error":"Internal Server Error"}`, which carries no code
        // and no requestId, and 500 tells a caller nothing useful — this is a
        // transient upstream condition, so 503 + retryAfter is the honest code.
        return c.json(
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
    };
}
