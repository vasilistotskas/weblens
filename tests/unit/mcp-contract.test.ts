/**
 * MCP tool definitions must agree with the endpoints they call.
 *
 * Regression: the published tool list advertised `waitFor` as a NUMBER
 * ("wait time in ms") for /fetch/pro, but FetchRequestSchema expects a CSS
 * selector STRING — an agent following the advertised schema got a 400. The
 * standalone mcp-server package had the same drift plus an `extract_data`
 * tool that posted `selectors` when /extract requires `schema`.
 *
 * This samples every MCP tool's declared inputSchema the way an agent would
 * (required properties, type-appropriate values) and asserts the endpoint's
 * canonical Zod schema accepts the result.
 */

import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
    FetchRequestSchema,
    ScreenshotRequestSchema,
    SearchRequestSchema,
    ExtractRequestSchema,
    SmartExtractRequestSchema,
    BatchFetchRequestSchema,
    ResearchRequestSchema,
    PdfRequestSchema,
    CompareRequestSchema,
    MonitorCreateRequestSchema,
    MemorySetRequestSchema,
    VerticalSearchRequestSchema,
    PlacesSearchRequestSchema,
    TrendsRequestSchema,
    YoutubeTranscriptRequestSchema,
    ContentsRequestSchema,
    AnswerRequestSchema,
    MapRequestSchema,
    DomainRequestSchema,
    CrawlRequestSchema,
    DeepResearchRequestSchema,
    PreviewRequestSchema,
} from "../../src/schemas";
import { TOOLS, TOOL_ENDPOINTS } from "../../src/tools/mcp";
import { companySchema, marketSchema, competitiveSchema, siteAuditSchema } from "../../src/tools/intel";

/** Endpoint path → the schema its route registers with validateRequest. */
const SCHEMA_BY_ENDPOINT: Record<string, z.ZodType> = {
    // Free, but still contract-checked: the tool must match the route's schema.
    "/preview": PreviewRequestSchema,
    "/fetch/basic": FetchRequestSchema,
    "/fetch/pro": FetchRequestSchema,
    "/fetch/resilient": FetchRequestSchema,
    "/screenshot": ScreenshotRequestSchema,
    "/search": SearchRequestSchema,
    "/search/news": VerticalSearchRequestSchema,
    "/search/images": VerticalSearchRequestSchema,
    "/search/places": PlacesSearchRequestSchema,
    "/search/shopping": VerticalSearchRequestSchema,
    "/search/scholar": VerticalSearchRequestSchema,
    "/search/autocomplete": VerticalSearchRequestSchema,
    "/search/trends": TrendsRequestSchema,
    "/social/youtube/transcript": YoutubeTranscriptRequestSchema,
    "/contents": ContentsRequestSchema,
    "/answer": AnswerRequestSchema,
    "/extract": ExtractRequestSchema,
    "/extract/smart": SmartExtractRequestSchema,
    "/research": ResearchRequestSchema,
    "/research/deep": DeepResearchRequestSchema,
    "/batch/fetch": BatchFetchRequestSchema,
    "/map": MapRequestSchema,
    "/domain": DomainRequestSchema,
    "/crawl": CrawlRequestSchema,
    "/pdf": PdfRequestSchema,
    "/compare": CompareRequestSchema,
    "/monitor/create": MonitorCreateRequestSchema,
    "/memory/set": MemorySetRequestSchema,
    "/intel/company": companySchema,
    "/intel/market": marketSchema,
    "/intel/competitive": competitiveSchema,
    "/intel/site-audit": siteAuditSchema,
};

interface JsonSchemaProp {
    type?: string;
    description?: string;
    enum?: unknown[];
    minimum?: number;
    maximum?: number;
    items?: JsonSchemaProp;
}
interface ToolInputSchema {
    type?: string;
    properties?: Record<string, JsonSchemaProp>;
    required?: string[];
}
interface McpTool { name: string; description: string; inputSchema: ToolInputSchema }

/** A value satisfying the declared JSON-Schema type, biased to realistic input. */
function sampleValue(key: string, prop: JsonSchemaProp): unknown {
    if (Array.isArray(prop.enum) && prop.enum.length > 0) { return prop.enum[0]; }
    switch (prop.type) {
        case "number":
        case "integer":
            return prop.minimum ?? 1;
        case "boolean":
            return true;
        case "array":
            // Two entries satisfies every min-2 array bound in the API.
            return /url/iu.test(key)
                ? ["https://example.com/a", "https://example.com/b"]
                : [sampleValue(key, prop.items ?? { type: "string" }), sampleValue(key, prop.items ?? { type: "string" })];
        case "object":
            return { field: { type: "string" } };
        case "string":
        default:
            if (/^url$|url$/iu.test(key)) { return "https://example.com"; }
            if (/videoid/iu.test(key)) { return "dQw4w9WgXcQ"; }
            if (/key$/iu.test(key)) { return "sample_key"; }
            return "sample";
    }
}

/** Build the body an agent would send when following the tool's schema. */
function sampleBody(tool: McpTool): Record<string, unknown> {
    const props = tool.inputSchema.properties ?? {};
    const required = tool.inputSchema.required ?? [];
    const body: Record<string, unknown> = {};
    for (const key of required) {
        const prop = props[key];
        if (prop) { body[key] = sampleValue(key, prop); }
    }
    return body;
}

const tools = TOOLS as unknown as McpTool[];

describe("MCP tool contracts", () => {
    it("exposes tools and maps each to an endpoint", () => {
        expect(tools.length).toBeGreaterThan(20);
        for (const tool of tools) {
            expect(TOOL_ENDPOINTS[tool.name], `${tool.name} has no endpoint mapping`).toBeDefined();
        }
    });

    it("every declared required property exists in the tool's properties", () => {
        for (const tool of tools) {
            const props = tool.inputSchema.properties ?? {};
            for (const key of tool.inputSchema.required ?? []) {
                expect(props[key], `${tool.name}.${key} is required but not declared`).toBeDefined();
            }
        }
    });

    it("a body built from each tool's schema passes the endpoint's Zod schema", () => {
        const failures: string[] = [];
        for (const tool of tools) {
            const endpoint = TOOL_ENDPOINTS[tool.name]?.endpoint;
            if (!endpoint) { continue; }
            const schema = SCHEMA_BY_ENDPOINT[endpoint];
            if (!schema) {
                failures.push(`${tool.name}: no canonical schema known for ${endpoint}`);
                continue;
            }
            const result = schema.safeParse(sampleBody(tool));
            if (!result.success) {
                failures.push(`${tool.name} -> ${endpoint}: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
            }
        }
        expect(failures, failures.join("\n")).toEqual([]);
    });

    // Zod strips unknown keys silently, so a tool can advertise a field the
    // API ignores and nothing fails loudly — that is how `includeLinks` /
    // `includeImages` survived on fetch_webpage. A property that does not
    // survive parsing is a phantom: agents are told to send something that
    // has no effect.
    it("advertises no phantom properties the endpoint silently discards", () => {
        const phantoms: string[] = [];
        for (const tool of tools) {
            const endpoint = TOOL_ENDPOINTS[tool.name]?.endpoint;
            const schema = endpoint ? SCHEMA_BY_ENDPOINT[endpoint] : undefined;
            if (!schema) { continue; }
            const props = tool.inputSchema.properties ?? {};
            for (const [key, prop] of Object.entries(props)) {
                const body = { ...sampleBody(tool), [key]: sampleValue(key, prop) };
                const result = schema.safeParse(body);
                if (!result.success) { continue; } // covered by the other tests
                if (!(key in (result.data as Record<string, unknown>))) {
                    phantoms.push(`${tool.name}.${key} -> ${String(endpoint)} (discarded by the API)`);
                }
            }
        }
        expect(phantoms, phantoms.join("\n")).toEqual([]);
    });

    it("optional properties are also accepted by the endpoint schema", () => {
        const failures: string[] = [];
        for (const tool of tools) {
            const endpoint = TOOL_ENDPOINTS[tool.name]?.endpoint;
            const schema = endpoint ? SCHEMA_BY_ENDPOINT[endpoint] : undefined;
            if (!schema) { continue; }
            const props = tool.inputSchema.properties ?? {};
            const full: Record<string, unknown> = sampleBody(tool);
            for (const [key, prop] of Object.entries(props)) {
                if (!(key in full)) { full[key] = sampleValue(key, prop); }
            }
            const result = schema.safeParse(full);
            if (!result.success) {
                failures.push(`${tool.name} -> ${String(endpoint)}: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
            }
        }
        expect(failures, failures.join("\n")).toEqual([]);
    });
});
