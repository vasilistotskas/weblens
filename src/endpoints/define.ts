/**
 * The endpoint registry's contract: everything a paid endpoint needs to be
 * served, priced and advertised, in ONE definition per endpoint.
 *
 * Definitions are data only (no handlers), so any module can read the catalog
 * without importing the request handlers and everything behind them. The
 * handlers are bound to these paths in src/routes/paid.ts, which the compiler
 * checks covers every path exactly once.
 */

import { z } from "zod";
import { PRICING } from "../config";
import {
    calculatePrice,
    complexityBasePrice,
    MAX_COMPLEXITY_MULTIPLIER,
    parsePrice,
    perUnitPrice,
} from "../services/pricing";
import type { ComplexityPricedEndpoint } from "../services/pricing";

/** A JSON object's schema, as advertised for a response body. */
export interface JsonObjectSchema {
    properties: Record<string, unknown>;
    required?: readonly string[];
}

/**
 * How an endpoint is priced. ONE model feeds the credit debit, the x402
 * challenge and every advertised price, so they can never disagree.
 *
 * `resolve` is a method (not a function-typed property) on purpose: method
 * parameters are bivariant, which lets every definition, each with its own
 * body type, live in one catalog array.
 */
export interface PriceModel<Body> {
    /**
     * The price for a request. `body` is the validated body, or undefined when
     * an unauthenticated probe's body did not validate (validation.ts lets
     * those through to the 402 challenge).
     */
    resolve(body: Body | undefined): string;
    /** Cheapest price any valid request produces, in USD, before the cache discount. */
    readonly min: number;
    /** Dearest price any valid request produces, in USD. */
    readonly max: number;
    /** The pricing rule in words, e.g. "$0.0015 per URL (1-20)". */
    readonly describe: string;
}

/**
 * Sections of the catalog, in the order the docs present them. Each becomes
 * an OpenAPI tag and an llms.txt section. "Credits" holds billing actions,
 * which discovery catalogs leave out of the product list.
 */
export const ENDPOINT_GROUPS = {
    Pages: "Fetch, render, map and crawl web pages",
    Extraction: "Structured data from pages and PDFs",
    Search: "Web search, its verticals, and Hacker News discussions",
    Research: "Cited answers and multi-step research",
    Social: "Social platform data",
    Intelligence: "Facts about a domain, a site's stack, a package, or a project",
    Credits: "Prepaid credit",
} as const;

export type EndpointGroup = keyof typeof ENDPOINT_GROUPS;

/** Error statuses an endpoint documents beyond validation (400) and payment (402). */
export type DocumentedErrorStatus = "403" | "404" | "422" | "502" | "503";

/** A request body schema: whatever it outputs, it accepts a JSON object. */
export type RequestSchema = z.ZodType<unknown, Record<string, unknown>>;

export interface EndpointDefinition<Path extends string = string, Input extends RequestSchema = RequestSchema> {
    path: Path;
    /** Short product name; also the label on credit ledger entries. */
    title: string;
    group: EndpointGroup;
    /** OpenAPI operationId. Kept stable: generated clients key on it. */
    operationId: string;
    /** What the buyer gets. Catalogs and the 402 challenge show it; keep it at most 500 characters. */
    description: string;
    /** Intent keywords facilitator catalogs index (x402 RouteConfig `tags`). */
    catalogTags: readonly string[];
    /** MCP tool name; endpoints without one are not offered as MCP tools. */
    mcpTool?: string;
    /** Typical wall-clock time, as advertised in the discovery catalog. */
    latency: string;
    /** One line on what the caller gets for the money (free previews). */
    previewSummary: string;
    /** Usage notes for agents, one bullet each in llms.txt. */
    guide?: readonly string[];
    /** Endpoint-specific failures, by HTTP status (documented in OpenAPI). */
    errors?: Readonly<Partial<Record<DocumentedErrorStatus, string>>>;
    /** Request body. Validates every paid call and generates the advertised input schema. */
    input: Input;
    inputExample: z.input<Input>;
    outputExample: Record<string, unknown>;
    outputSchema: JsonObjectSchema;
    price: PriceModel<z.output<Input>>;
    /** Cache namespace for endpoints that serve cached responses at a discount (see middleware/cache.ts). */
    cacheKey?: string;
    /** Whether a funded credit account can pay instead of x402. */
    acceptsCredits: boolean;
    /** Only payable on EVM networks (the handler needs an EIP-3009 payer). */
    evmOnly: boolean;
}

/** Identity function that keeps each definition's literal path and its own body type. */
export function defineEndpoint<const Path extends string, Input extends RequestSchema>(
    definition: EndpointDefinition<Path, Input>,
): EndpointDefinition<Path, Input> {
    return definition;
}

/** A price that never varies with the request. */
export function fixedPrice(price: string): PriceModel<unknown> {
    const amount = parsePrice(price);
    return { resolve: () => price, min: amount, max: amount, describe: price };
}

/**
 * A linear price per unit (URL, page). `units` reads the count from the body
 * and must return the default count when there is no validated body.
 */
export function perUnitPricing<Body>(
    unitPrice: string,
    bounds: { min: number; max: number; unit: string },
    units: (body: Body | undefined) => number,
): PriceModel<Body> {
    return {
        resolve: (body) => perUnitPrice(unitPrice, units(body)),
        min: parsePrice(perUnitPrice(unitPrice, bounds.min)),
        max: parsePrice(perUnitPrice(unitPrice, bounds.max)),
        describe: `${unitPrice} per ${bounds.unit} (${String(bounds.min)}-${String(bounds.max)})`,
    };
}

/**
 * A base price scaled by the target URL's complexity (services/pricing.ts).
 * With no validated URL it charges the base price: an unparseable URL counts
 * as medium complexity, which would quote probes 1.5x the real price.
 */
export function complexityPricing(type: ComplexityPricedEndpoint): PriceModel<{ url: string }> {
    const base = complexityBasePrice(type);
    return {
        resolve: (body) => (body ? calculatePrice(body.url, type) : base),
        min: parsePrice(base),
        max: parsePrice(base) * MAX_COMPLEXITY_MULTIPLIER,
        describe: `${base}, up to ${String(MAX_COMPLEXITY_MULTIPLIER)}x on bot-protected or complex sites`,
    };
}

/** The pricing rule in words, including the cache discount where it applies. */
export function describePrice(endpoint: EndpointDefinition): string {
    const { describe } = endpoint.price;
    return endpoint.cacheKey
        ? `${describe} (${String(Math.round(PRICING.cacheDiscount * 100))}% off when served from cache)`
        : describe;
}

/**
 * The request body's JSON Schema as buyers should send it: fields with a
 * default are optional, and the `$schema` dialect marker is dropped because
 * the schema is embedded inside other documents.
 */
export function requestBodySchema(input: z.ZodType): Record<string, unknown> {
    const { $schema: _dialect, ...schema } = z.toJSONSchema(input, { io: "input" });
    return schema;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * An endpoint's request body schema with each property's value from the
 * endpoint's (validated) input example as its `example`. Catalog probes such
 * as x402scan's build a body from property examples, and a required array or
 * object without one cannot be sampled into a body that validates.
 */
export function endpointBodySchema(endpoint: EndpointDefinition): Record<string, unknown> {
    const schema = requestBodySchema(endpoint.input);
    const { properties } = schema;
    if (!isRecord(properties)) { return schema; }
    const example = endpoint.inputExample;
    return {
        ...schema,
        properties: Object.fromEntries(Object.entries(properties).map(([key, property]) => [
            key,
            isRecord(property) && key in example ? { ...property, example: example[key] } : property,
        ])),
    };
}
