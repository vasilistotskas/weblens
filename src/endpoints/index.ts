/**
 * The paid endpoint registry: one definition per endpoint (src/endpoints/*),
 * from which the routes, the path lists below and every advertised price,
 * schema and catalog tag are derived.
 */

import { x402PriceBounds } from "./define";
import type { EndpointDefinition } from "./define";
import { INTEL_ENDPOINTS } from "./intel";
import { PAGE_ENDPOINTS } from "./pages";
import { SEARCH_ENDPOINTS } from "./search";

export const ENDPOINTS = [
    ...PAGE_ENDPOINTS,
    ...SEARCH_ENDPOINTS,
    ...INTEL_ENDPOINTS,
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

/** The x402 price range across the products, as discovery surfaces advertise it. */
export function productPriceRange(): string {
    const bounds = ENDPOINTS.map((endpoint) => x402PriceBounds(endpoint));
    const format = (amount: number): string => (amount < 0.01 ? amount.toFixed(4) : amount.toFixed(2));
    const min = Math.min(...bounds.map((b) => b.min));
    const max = Math.max(...bounds.map((b) => b.max));
    return `$${format(min)} - $${format(max)} per request`;
}
