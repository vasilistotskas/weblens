/**
 * Health Check Endpoint Handler
 * GET /health - System health status
 * 
 * Requirements: 5.2
 * - Return system health status including cache availability and facilitator connectivity
 */

import type { Context } from "hono";
import { SERVICE_VERSION } from "../config";
import { distinctFacilitators, facilitatorPlans } from "../middleware/payment";
import type { FacilitatorEntry } from "../middleware/payment";
import type { FacilitatorLabel } from "../services/payment-telemetry";
import type { AppEnv, HealthResponse, ServiceStatus } from "../types";

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
 * Determine overall system status. Any service that is not healthy degrades
 * the system; it is unhealthy only when the cache is down or a network family
 * has no reachable facilitator left to settle its payments.
 */
function getOverallStatus(all: ServiceStatus[], criticalDown: boolean): HealthResponse["status"] {
  if (all.every((s) => s.status === "healthy")) {
    return "healthy";
  }
  return criticalDown ? "unhealthy" : "degraded";
}

/** Probe one facilitator, keyed by its name for the response. */
async function probeFacilitator({ label, client }: FacilitatorEntry): Promise<[FacilitatorLabel, ServiceStatus]> {
  return [label, await checkFacilitatorHealth(client.url)];
}

/**
 * Health check endpoint handler
 * GET /health
 *
 * Reports every facilitator the payment wall uses, from the same plans
 * (facilitatorPlans). A family still takes payments while any facilitator in
 * its chain is reachable.
 */
export async function health(c: Context<AppEnv>): Promise<Response> {
  const browserStatus = checkBrowserHealth(c.env.BROWSER);
  const plans = facilitatorPlans(c.env);
  const [cacheStatus, facilitatorChecks] = await Promise.all([
    checkCacheHealth(c.env.CACHE),
    Promise.all(distinctFacilitators(plans).map(probeFacilitator)),
  ]);
  const statusOf = new Map(facilitatorChecks);
  const familyDown = plans.some(({ facilitators }) =>
    facilitators.every(({ label }) => statusOf.get(label)?.status === "unhealthy"));

  const services: HealthResponse["services"] = {
    cache: cacheStatus,
    browserRendering: browserStatus,
    facilitators: Object.fromEntries(facilitatorChecks),
  };

  const response: HealthResponse = {
    status: getOverallStatus(
      [cacheStatus, browserStatus, ...facilitatorChecks.map(([, status]) => status)],
      cacheStatus.status === "unhealthy" || familyDown,
    ),
    version: SERVICE_VERSION,
    timestamp: new Date().toISOString(),
    services,
  };

  // Return 200 for healthy/degraded, 503 for unhealthy
  const httpStatus = response.status === "unhealthy" ? 503 : 200;

  return c.json(response, httpStatus);
}
