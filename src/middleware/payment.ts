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
import type { Address } from "viem";
import type { Env, Variables } from "../types";

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
export function getResourceServer(env: Env): x402ResourceServer {
    const key = envSignature(env);
    const cached = resourceServerCache.get(key);
    if (cached) {return cached;}

    console.log("🔧 [Init] Creating x402 resource server...");

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
        facilitatorClients = [payaiClient, cdpClient];
        facilitatorLabel = `payai (primary) + cdp (fallback)`;
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
        console.error("❌ [x402 Verify Failure]", {
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
        console.error("❌ [x402 Settle Failure]", {
            scheme: payload?.scheme,
            network: payload?.network,
            payTo: reqs?.payTo,
            amount: reqs?.amount,
            error: ctx.error.message,
        });
        return Promise.resolve();
    });

    resourceServerCache.set(key, server);

    console.log("✅ [Init] x402 resource server ready");
    console.log("   Network:", NETWORK_CAIP2);
    console.log("   Facilitator:", facilitatorLabel);

    return server;
}

// ============================================
// Configuration Helpers
// ============================================

/**
 * Build a RoutesConfig object for x402 payment middleware.
 * Includes Bazaar discovery extensions when input/output schemas are provided.
 */
export function createPaymentConfig(
    path: string,
    price: string,
    destinationAddress: string,
    networkCaip2: string,
    description: string,
    inputExample?: Record<string, unknown>,
    inputSchema?: Record<string, unknown>,
    outputExample?: Record<string, unknown>,
    outputSchema?: Record<string, unknown>
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
        [path]: {
            accepts: [{
                scheme: "exact" as const,
                price,
                network: networkCaip2,
                payTo: destinationAddress,
            }],
            description,
            mimeType: "application/json" as const,
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
const middlewareCache = new Map<
    string,
    MiddlewareHandler<{ Bindings: Env; Variables: Variables }>
>();

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
            ].join("|")
            : null;

        let middleware = cacheKey ? middlewareCache.get(cacheKey) : undefined;
        if (!middleware) {
            const config = createPaymentConfig(
                path,
                price,
                recipientAddress,
                networkCaip2,
                description,
                inputExample,
                inputSchema,
                outputExample,
                outputSchema
            );
            const server = getResourceServer(env);
            middleware = paymentMiddleware(config, server) as MiddlewareHandler<{
                Bindings: Env;
                Variables: Variables;
            }>;
            if (cacheKey) {
                middlewareCache.set(cacheKey, middleware);
                console.log(`✅ [Init] payment middleware ready for ${path} (${price})`);
            } else {
                console.log(`💲 [Dynamic] price for ${path}: ${price}`);
            }
        }

        return middleware(c, next);
    };
}
