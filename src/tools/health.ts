/**
 * Health Check Endpoint Handler
 * GET /health - System health status
 * 
 * Requirements: 5.2
 * - Return system health status including cache availability and facilitator connectivity
 */

import type { Context } from "hono";
import type { Env, HealthResponse, ServiceStatus } from "../types";

// Facilitator endpoints used for reachability probes. Kept local to this file
// because they are only relevant to the health probe, not payment routing.
const PAYAI_FACILITATOR_URL = "https://facilitator.payai.network";
const CDP_FACILITATOR_URL = "https://api.cdp.coinbase.com";
const TESTNET_FACILITATOR_URL = "https://x402.org/facilitator";

/**
 * Check cache service health
 */
async function checkCacheHealth(kv: KVNamespace | undefined): Promise<ServiceStatus> {
  if (!kv) {
    return {
      status: "unhealthy",
      error: "KV namespace not configured",
    };
  }

  const startTime = Date.now();
  try {
    // Try to read a non-existent key to test connectivity
    await kv.get("__health_check__");
    const latency = Date.now() - startTime;
    return {
      status: "healthy",
      latency,
    };
  } catch (error) {
    return {
      status: "unhealthy",
      latency: Date.now() - startTime,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Check browser rendering service health
 */
function checkBrowserHealth(browser: Fetcher | undefined): ServiceStatus {
  if (!browser) {
    return {
      status: "unhealthy",
      error: "Browser binding not configured",
    };
  }

  // Browser binding exists, assume healthy
  // Actual browser launch is expensive, so we just check binding exists
  return {
    status: "healthy",
    latency: 0,
  };
}

/**
 * Check facilitator connectivity. Treats 401/403/404 as "reachable" since an
 * unauthenticated GET against a real facilitator endpoint will often return
 * one of those — the server is up, we just don't hold credentials for a bare
 * probe.
 */
async function checkFacilitatorHealth(url: string): Promise<ServiceStatus> {
  const startTime = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    const latency = Date.now() - startTime;

    if (response.ok || [401, 403, 404].includes(response.status)) {
      return {
        status: "healthy",
        latency,
      };
    }

    return {
      status: "degraded",
      latency,
      error: `HTTP ${String(response.status)}`,
    };
  } catch (error) {
    return {
      status: "unhealthy",
      latency: Date.now() - startTime,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

/**
 * Select the facilitator URL the running worker will actually use for x402
 * settlement. Mirrors the branch logic in src/middleware/payment.ts so /health
 * reflects reality.
 */
function getActiveFacilitatorUrl(env: Env): string {
  if (env.NETWORK === "base-sepolia" || env.FACILITATOR_URL?.includes("x402.org")) {
    return env.FACILITATOR_URL ?? TESTNET_FACILITATOR_URL;
  }
  if (env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET) {
    return CDP_FACILITATOR_URL;
  }
  return env.PAYAI_FACILITATOR_URL ?? PAYAI_FACILITATOR_URL;
}

/**
 * Determine overall system status from service statuses
 */
function getOverallStatus(services: HealthResponse["services"]): HealthResponse["status"] {
  const statuses = [
    services.cache.status,
    services.browserRendering.status,
    services.facilitators.cdp.status,
    services.facilitators.payai.status,
  ];

  if (statuses.every((s) => s === "healthy")) {
    return "healthy";
  }

  if (statuses.some((s) => s === "unhealthy")) {
    // If critical services are unhealthy, system is unhealthy
    if (
      services.cache.status === "unhealthy" ||
      services.facilitators.cdp.status === "unhealthy"
    ) {
      return "unhealthy";
    }
    return "degraded";
  }

  return "degraded";
}

/**
 * Health check endpoint handler
 * GET /health
 */
export async function health(c: Context<{ Bindings: Env }>): Promise<Response> {
  // Check all services in parallel.
  //
  // The "cdp" field reports the facilitator the worker is actually using:
  // - CDP API endpoint when CDP_API_KEY_ID/SECRET are set (production default)
  // - x402.org testnet facilitator when NETWORK=base-sepolia
  // - PayAI fallback otherwise
  // The "payai" field is always probed as a secondary reachability signal.
  const browserStatus = checkBrowserHealth(c.env.BROWSER);
  const activeFacilitatorUrl = getActiveFacilitatorUrl(c.env);
  const [cacheStatus, cdpStatus, payaiStatus] = await Promise.all([
    checkCacheHealth(c.env.CACHE),
    checkFacilitatorHealth(activeFacilitatorUrl),
    checkFacilitatorHealth(PAYAI_FACILITATOR_URL),
  ]);

  const services: HealthResponse["services"] = {
    cache: cacheStatus,
    browserRendering: browserStatus,
    facilitators: {
      cdp: cdpStatus,
      payai: payaiStatus,
    },
  };

  const response: HealthResponse = {
    status: getOverallStatus(services),
    version: "2.0.0",
    timestamp: new Date().toISOString(),
    services,
  };

  // Return 200 for healthy/degraded, 503 for unhealthy
  const httpStatus = response.status === "unhealthy" ? 503 : 200;

  return c.json(response, httpStatus);
}
