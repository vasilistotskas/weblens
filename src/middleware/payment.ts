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
// Resource Server Singleton
// ============================================

let resourceServer: x402ResourceServer | null = null;

/**
 * Get or create the x402 resource server singleton.
 * Initializes the facilitator client and EVM scheme on first call.
 */
export function getResourceServer(env: Env): x402ResourceServer {
    if (resourceServer) {
        return resourceServer;
    }

    console.log("🔧 [First Request] Initializing x402 resource server...");

    // Network configuration
    // For Base Sepolia (testnet): eip155:84532
    // For Base mainnet: eip155:8453
    const NETWORK_CAIP2 = env.NETWORK === "base-sepolia" ? "eip155:84532" : "eip155:8453";

    // Create facilitator client
    let facilitatorClient: HTTPFacilitatorClient;

    if (env.NETWORK === "base-sepolia" || env.FACILITATOR_URL?.includes("x402.org")) {
        // Testnet
        facilitatorClient = new HTTPFacilitatorClient({
            url: env.FACILITATOR_URL ?? "https://x402.org/facilitator"
        });
    } else if (env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET) {
        // Mainnet via CDP
        facilitatorClient = new HTTPFacilitatorClient(
            createFacilitatorConfig(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET)
        );
    } else {
        // Mainnet via PayAI (Public/Shared)
        facilitatorClient = new HTTPFacilitatorClient({
            url: env.PAYAI_FACILITATOR_URL ?? "https://facilitator.payai.network"
        });
    }

    // Create and configure resource server
    resourceServer = new x402ResourceServer(facilitatorClient);
    resourceServer.register(NETWORK_CAIP2, new ExactEvmScheme());
    resourceServer.registerExtension(bazaarResourceServerExtension);

    console.log("✅ [First Request] x402 resource server initialized");
    console.log("   Network:", NETWORK_CAIP2);

    return resourceServer;
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
                payTo: destinationAddress as Address,
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

/**
 * Create a lazy-initialized x402 payment middleware.
 * Supports both static prices and dynamic price calculators.
 * Skips payment if the request was already paid via credit account.
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
    let staticMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> | null = null;

    return async (c, next) => {
        // If already paid with credits, skip x402 payment middleware
        if (c.get("paidWithCredits")) {
            await next();
            return;
        }

        const env = c.env;
        const recipientAddress = env.PAY_TO_ADDRESS;
        const networkCaip2 = env.NETWORK === "base-sepolia" ? "eip155:84532" : "eip155:8453";

        let price: string;

        // Determine price
        if (typeof priceOrCalculator === "function") {
            // Dynamic pricing
            price = await priceOrCalculator(c);
        } else {
            // Static pricing
            price = priceOrCalculator;
        }

        // Optimization: reusing middleware instance for static pricing
        if (typeof priceOrCalculator === "string" && staticMiddleware) {
            return staticMiddleware(c, next);
        }

        // Create middleware instance (dynamic or first-time static)
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
        const middleware = paymentMiddleware(config, server) as MiddlewareHandler<{ Bindings: Env; Variables: Variables }>;

        if (typeof priceOrCalculator === "string") {
            staticMiddleware = middleware;
            console.log(`✅ [Lazy Init] Static payment middleware initialized for ${path} (${price})`);
        } else {
            console.log(`💲 [Dynamic Pricing] Calculated price for ${path}: ${price}`);
        }

        return middleware(c, next);
    };
}
