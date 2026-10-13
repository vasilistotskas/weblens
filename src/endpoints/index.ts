/**
 * The paid endpoint registry: one definition per endpoint (src/endpoints/*),
 * from which the routes, the path lists below and every advertised price,
 * schema and catalog tag are derived.
 */

import { BILLING_ENDPOINTS } from "./billing";
import type { EndpointDefinition } from "./define";
import { INTEL_ENDPOINTS } from "./intel";
import { PAGE_ENDPOINTS } from "./pages";
import { SEARCH_ENDPOINTS } from "./search";

export const ENDPOINTS = [
    ...PAGE_ENDPOINTS,
    ...SEARCH_ENDPOINTS,
    ...INTEL_ENDPOINTS,
    ...BILLING_ENDPOINTS,
] as const;

export type PaidEndpoint = (typeof ENDPOINTS)[number];
export type PaidPath = PaidEndpoint["path"];

/**
 * Paid POST paths. Used by the POST-only enforcement middleware and by request
 * validation: unauthenticated probes of these paths fall through to the x402
 * 402 challenge instead of a 400, so agents that probe without reading the
 * spec still discover a payable resource.
 */
export const PAID_ENDPOINTS: readonly string[] = ENDPOINTS.map((endpoint) => endpoint.path);

const BY_PATH: ReadonlyMap<string, EndpointDefinition> = new Map(ENDPOINTS.map((endpoint) => [endpoint.path, endpoint]));

/** The definition for a paid path, or undefined when nothing is sold there. */
export function endpointForPath(path: string): EndpointDefinition | undefined {
    return BY_PATH.get(path);
}

/** Paid paths that only accept EVM payments (see each definition's `evmOnly`). */
export const EVM_ONLY_PAID_PATHS: readonly string[] = ENDPOINTS
    .filter((endpoint) => endpoint.evmOnly)
    .map((endpoint) => endpoint.path);
