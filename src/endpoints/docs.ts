/**
 * Documentation rendered from the endpoint registry: the paid operations of
 * the OpenAPI document (which doubles as the x402scan discovery document) and
 * the per-endpoint sections of llms.txt. Every price, schema and example comes
 * from the definitions, so the docs cannot drift from what the routes charge
 * and accept.
 */

import { PRICING } from "../config";
import { describePrice, ENDPOINT_GROUPS, endpointBodySchema, requestBodySchema } from "./define";
import type { EndpointDefinition, EndpointGroup } from "./define";
import { ENDPOINTS } from "./index";

const DEFINITIONS: readonly EndpointDefinition[] = ENDPOINTS;

const ERROR_CONTENT = { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * x402scan's x-payment-info (https://www.x402scan.com/discovery/spec): a fixed
 * amount when every request pays the same, otherwise the range any request
 * can pay. Amounts are decimal USD; the 402 challenge carries atomic units.
 */
export function paymentInfo(endpoint: EndpointDefinition) {
    const { price, cacheKey } = endpoint;
    const min = cacheKey ? price.min * (1 - PRICING.cacheDiscount) : price.min;
    const protocols = [{ x402: {} }];
    if (min === price.max) {
        return { price: { mode: "fixed" as const, currency: "USD", amount: price.max.toFixed(6) }, protocols };
    }
    return { price: { mode: "dynamic" as const, currency: "USD", min: min.toFixed(6), max: price.max.toFixed(6) }, protocols };
}

/** The OpenAPI operation for one paid endpoint. */
export function openApiOperation(endpoint: EndpointDefinition) {
    const errors = Object.entries(endpoint.errors ?? {}).map(
        ([status, description]): [string, { description: string; content: typeof ERROR_CONTENT }] =>
            [status, { description, content: ERROR_CONTENT }],
    );
    return {
        tags: [endpoint.group],
        summary: endpoint.title,
        operationId: endpoint.operationId,
        description: `${endpoint.description} Price: ${describePrice(endpoint)}.`,
        "x-payment-info": paymentInfo(endpoint),
        requestBody: {
            required: true,
            content: { "application/json": { schema: endpointBodySchema(endpoint), example: endpoint.inputExample } },
        },
        responses: {
            "200": {
                description: endpoint.previewSummary,
                content: { "application/json": { schema: { type: "object", ...endpoint.outputSchema }, example: endpoint.outputExample } },
            },
            "400": { description: "The body failed validation", content: ERROR_CONTENT },
            "402": { $ref: "#/components/responses/PaymentRequired" },
            ...Object.fromEntries(errors),
        },
    };
}

/** OpenAPI `paths` entries for every paid endpoint. */
export function openApiPaidPaths(): Record<string, { post: ReturnType<typeof openApiOperation> }> {
    return Object.fromEntries(DEFINITIONS.map((endpoint) => [endpoint.path, { post: openApiOperation(endpoint) }]));
}

/** One JSON Schema property in llms.txt shorthand, e.g. `number (1-20, default 10)`. */
function describeProperty(schema: unknown): string {
    if (!isRecord(schema)) { return "any"; }
    if (Array.isArray(schema.enum)) {
        return schema.enum.map((value) => JSON.stringify(value)).join("|");
    }
    const notes: string[] = [];
    const lower = schema.minimum ?? schema.minItems ?? schema.minLength;
    const upper = schema.maximum ?? schema.maxItems ?? schema.maxLength;
    if (typeof lower === "number" && typeof upper === "number") {
        notes.push(`${String(lower)}-${String(upper)}${typeof schema.minLength === "number" ? " chars" : ""}`);
    }
    if (schema.default !== undefined && !(Array.isArray(schema.default) && schema.default.length === 0)) {
        notes.push(`default ${JSON.stringify(schema.default)}`);
    }
    const suffix = notes.length > 0 ? ` (${notes.join(", ")})` : "";
    switch (schema.type) {
        case "string":
            return `"${schema.format === "uri" ? "url" : "string"}"${suffix}`;
        case "array":
            return `[${describeProperty(schema.items)}]${suffix}`;
        case "number":
        case "integer":
        case "boolean":
            return `${schema.type}${suffix}`;
        default:
            return `object${suffix}`;
    }
}

/** A request body in llms.txt shorthand: `{"url": "url", "timeout?": number (...)}`. */
export function describeBody(schema: Record<string, unknown>): string {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const fields = Object.entries(properties).map(([name, property]) =>
        `"${name}${required.has(name) ? "" : "?"}": ${describeProperty(property)}`);
    return `{${fields.join(", ")}}`;
}

/** A response's shape, read off its example: keys, nested objects, and the element shape of arrays. */
export function describeShape(value: unknown): string {
    if (Array.isArray(value)) {
        const first: unknown = value[0];
        if (first === undefined) { return "[]"; }
        return isRecord(first) || Array.isArray(first) ? `[${describeShape(first)}]` : `["${typeof first}"]`;
    }
    if (!isRecord(value)) { return `"${typeof value}"`; }
    const fields = Object.entries(value).map(([key, child]) =>
        isRecord(child) || Array.isArray(child) ? `"${key}": ${describeShape(child)}` : `"${key}"`);
    return `{${fields.join(", ")}}`;
}

/** One endpoint's llms.txt section. */
function llmsSection(endpoint: EndpointDefinition): string {
    return [
        `#### POST ${endpoint.path}`,
        endpoint.description,
        `- Price: ${describePrice(endpoint)}`,
        `- Body: \`${describeBody(requestBodySchema(endpoint.input))}\``,
        `- Returns: \`${describeShape(endpoint.outputExample)}\``,
        ...(endpoint.guide ?? []).map((note) => `- ${note}`),
    ].join("\n");
}

/** Every paid endpoint's llms.txt section, grouped and in catalog order. */
export function llmsEndpointSections(): string {
    return (Object.keys(ENDPOINT_GROUPS) as EndpointGroup[])
        .map((group) => {
            const members = DEFINITIONS.filter((endpoint) => endpoint.group === group);
            if (members.length === 0) { return ""; }
            return `### ${group}: ${ENDPOINT_GROUPS[group]}\n\n${members.map(llmsSection).join("\n\n")}\n`;
        })
        .filter((section) => section !== "")
        .join("\n");
}

/** The MCP tools list for llms.txt, one line per paid tool. */
export function llmsMcpToolLines(): string {
    return DEFINITIONS
        .flatMap((endpoint) => endpoint.mcpTool === undefined
            ? []
            : [`- \`${endpoint.mcpTool}\` - ${endpoint.title} — ${describePrice(endpoint)}`])
        .join("\n");
}

