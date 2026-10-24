/**
 * Free previews — the evaluation-friction fix.
 *
 * Agents discover the catalogue, cannot judge whether an endpoint is worth
 * its price, and leave without paying. A preview lets them see the exact
 * price for their own request body plus a real sample of the response shape
 * before committing.
 *
 * COST RULE: a preview must never cost us money. Endpoints backed by a paid
 * upstream (Serper, SerpAPI, Anthropic) are NEVER executed for free — they return a
 * recorded sample. Only endpoints whose marginal cost is a plain fetch may
 * run live, truncated, and rate-limited.
 */

import { ENDPOINTS, endpointForPath, PAID_ENDPOINTS } from "../endpoints";
import { describePrice as describeEndpointPrice } from "../endpoints/define";

/**
 * Endpoints whose marginal cost is a native fetch (no paid upstream API), so
 * a truncated live preview is free to serve.
 */
export const LIVE_PREVIEW_ENDPOINTS: readonly string[] = [
    "/fetch/basic",
    "/contents",
    "/map",
    "/domain",
    "/tech",
    "/intel/project",
];

/** Characters of live preview content returned per request. */
export const LIVE_PREVIEW_CHARS = 500;

interface PreviewEntry {
    /** One line on what the caller gets for the money. */
    summary: string;
    /** Recorded example of the real response shape. */
    sample: Record<string, unknown>;
}

/**
 * Recorded response samples, one per paid endpoint, taken from each registry
 * definition (the same example the 402 challenge advertises). They illustrate
 * SHAPE and field names — a preview also returns the live price, and for
 * LIVE_PREVIEW_ENDPOINTS a real truncated result.
 */
export const PREVIEW_SAMPLES: Readonly<Record<string, PreviewEntry>> = Object.fromEntries(
    ENDPOINTS.map((endpoint) => [endpoint.path, { summary: endpoint.previewSummary, sample: endpoint.outputExample }]),
);

/** Human-readable price description for an endpoint, from its registry definition. */
export function describePrice(endpoint: string): string {
    const definition = endpointForPath(endpoint);
    return definition ? describeEndpointPrice(definition) : "see the 402 challenge";
}

export function isPaidEndpoint(endpoint: string): boolean {
    return PAID_ENDPOINTS.includes(endpoint);
}
