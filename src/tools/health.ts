/**
 * Health Check Endpoint Handler
 * GET /health - System health status
 * 
 * Requirements: 5.2
 * - Return system health status including cache availability and facilitator connectivity
 */

import type { Context } from "hono";
import type { Env, HealthResponse, ServiceStatus } from "../types";
import { FACILITATORS } from "../config";

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
async function checkBrowserHealth(browser: Fetcher | undefined): Promise<ServiceStatus> {
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
 * Check facilitator connectivity
 */
async function checkFacilitatorHealth(url: string): Promise<ServiceStatus> {
  const startTime = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    const latency = Date.now() - startTime;

    if (response.ok || response.status === 404) {
      // 404 is acceptable - facilitator is reachable but endpoint doesn't exist
      return {
        status: "healthy",
        latency,
      };
    }

    return {
      status: "degraded",
      latency,
      error: `HTTP ${response.status}`,
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
  // Check all services in parallel
  const [cacheStatus, browserStatus, cdpStatus, payaiStatus] = await Promise.all([
    checkCacheHealth(c.env.CACHE),
    checkBrowserHealth(c.env.BROWSER),
    checkFacilitatorHealth(FACILITATORS.cdp),
    checkFacilitatorHealth(FACILITATORS.payai),
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
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    services,
  };

  // Return 200 for healthy/degraded, 503 for unhealthy
  const httpStatus = response.status === "unhealthy" ? 503 : 200;

  return c.json(response, httpStatus);
}
