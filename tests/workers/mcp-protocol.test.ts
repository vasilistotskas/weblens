/**
 * /mcp protocol conformance, driven through the real Worker.
 *
 * These are the shapes MCP clients actually parse during the handshake, and
 * every one of them was wrong in production: `initialize` returned name and
 * version at the top level of `result` instead of nested under `serverInfo`,
 * and `notifications/initialized` — the message every compliant client sends
 * immediately after initialize — fell through to a `-32601 Method not found`
 * response, which is doubly illegal because notifications carry no id and
 * must never be answered at all.
 *
 * A registry listing is only worth having if the handshake works, so these
 * are pinned rather than left to manual probing.
 */

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { TOOL_ENDPOINTS } from "../../src/tools/mcp";

const MCP_URL = "https://api.weblens.dev/mcp";

function rpc(body: unknown) {
    return SELF.fetch(MCP_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(body),
    });
}

describe("MCP initialize", () => {
    it("nests name and version under serverInfo", async () => {
        const res = await rpc({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
        });
        expect(res.status).toBe(200);

        const body = await res.json<{ result: Record<string, unknown> }>();
        expect(body.result.serverInfo).toEqual({ name: "weblens", version: "2.1.0" });
        // The flat shape is what broke clients — it must not come back.
        expect(body.result.name).toBeUndefined();
        expect(body.result.version).toBeUndefined();
    });

    it("reports a protocol version and tool capability", async () => {
        const res = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
        const body = await res.json<{ result: { protocolVersion: string; capabilities: Record<string, unknown> } }>();

        expect(body.result.protocolVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
        expect(body.result.capabilities).toHaveProperty("tools");
    });
});

describe("MCP notifications", () => {
    it("accepts notifications/initialized with 202 and no body", async () => {
        const res = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
        expect(res.status).toBe(202);
        expect(await res.text()).toBe("");
    });

    it("never answers a notification, even an unknown one", async () => {
        // No id => notification. Replying at all is a protocol violation.
        for (const method of ["notifications/cancelled", "notifications/progress", "does/not/exist"]) {
            const res = await rpc({ jsonrpc: "2.0", method });
            expect(res.status, method).toBe(202);
            expect(await res.text(), method).toBe("");
        }
    });
});

describe("MCP requests", () => {
    it("lists tools with JSON Schema input", async () => {
        const res = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
        const body = await res.json<{ result: { tools: { name: string; inputSchema: unknown }[] } }>();

        expect(body.result.tools.length).toBeGreaterThan(0);
        for (const tool of body.result.tools) {
            expect(tool.inputSchema, tool.name).toHaveProperty("type", "object");
        }
    });

    it("still errors on an unknown method that carries an id", async () => {
        const res = await rpc({ jsonrpc: "2.0", id: 3, method: "no/such/method" });
        const body = await res.json<{ error: { code: number } }>();
        expect(body.error.code).toBe(-32601);
    });
});


describe("MCP tool calls", () => {
    // Every `tools/call` answered `{"error":{"code":522}}` in production — free
    // tools included — because the bridge reached its own endpoints with
    // `fetch()` and this Worker serves a Cloudflare Custom Domain, where a
    // Worker fetching its own hostname returns 522. Nothing in the handshake
    // tests above could see it: initialize and tools/list never leave the
    // isolate, so the registry listing looked healthy while every tool was dead.
    it("dispatches a free tool in-process and returns its JSON result", async () => {
        const res = await rpc({
            jsonrpc: "2.0",
            id: 10,
            method: "tools/call",
            params: { name: "preview_endpoint", arguments: { endpoint: "/fetch/basic" } },
        });
        expect(res.status).toBe(200);

        const body = await res.json<{
            result?: { content: { type: string; text: string }[] };
            error?: { code: number; message: string };
        }>();

        expect(body.error).toBeUndefined();
        const text = body.result?.content?.[0]?.text ?? "";
        expect(JSON.parse(text)).toMatchObject({ endpoint: "/fetch/basic" });
    });

    it("never answers a tool call with a Cloudflare edge error", async () => {
        // 520-527 are Cloudflare origin errors. None of them is ever a
        // legitimate answer from a Worker talking to itself.
        const calls: [string, Record<string, unknown>][] = [
            ["preview_endpoint", { endpoint: "/fetch/basic" }],
            ["fetch_webpage", { url: "https://example.com" }],
        ];

        for (const [name, args] of calls) {
            const res = await rpc({
                jsonrpc: "2.0",
                id: 11,
                method: "tools/call",
                params: { name, arguments: args },
            });
            const body = await res.json<{ error?: { code: number } }>();
            const code = body.error?.code ?? 0;

            expect(code < 520 || code > 527, `${name} answered ${String(code)}`).toBe(true);
        }
    });

    it("walls an unpaid paid tool with 402, not an opaque failure", async () => {
        const res = await rpc({
            jsonrpc: "2.0",
            id: 12,
            method: "tools/call",
            params: { name: "fetch_webpage", arguments: { url: "https://example.com" } },
        });

        const body = await res.json<{ error?: { code: number; data?: Record<string, unknown> } }>();

        // 503 is the honest answer when the facilitator is not advertising the
        // network (see the wall-failure path in middleware/payment.ts); anything
        // else here means the request never reached the payment middleware.
        expect([402, 503]).toContain(body.error?.code);
        if (body.error?.code === 402) {
            expect(body.error.data?.endpoint).toBe("/fetch/basic");
            expect(body.error.data?.price).toBeTruthy();
        }
    });

    it("rejects an unknown tool with -32602", async () => {
        const res = await rpc({
            jsonrpc: "2.0",
            id: 13,
            method: "tools/call",
            params: { name: "no_such_tool", arguments: {} },
        });
        const body = await res.json<{ error: { code: number } }>();
        expect(body.error.code).toBe(-32602);
    });

    it("routes no tool back at /mcp, which would recurse", () => {
        for (const [name, config] of Object.entries(TOOL_ENDPOINTS)) {
            expect(config?.endpoint, name).not.toBe("/mcp");
        }
    });
});

describe("MCP transport", () => {
    // Streamable HTTP makes the server-to-client SSE stream optional: the server
    // "MUST respond with Content-Type: text/event-stream or 405 Method Not
    // Allowed". WebLens has nothing to push, so it declines — and clients do
    // ask (~1.5k GETs a week), so the shape is pinned.
    it("declines the optional SSE stream with a conformant 405", async () => {
        const res = await SELF.fetch(MCP_URL, { headers: { Accept: "text/event-stream" } });

        expect(res.status).toBe(405);
        expect(res.headers.get("Allow")).toBe("POST");
        expect(res.headers.get("Content-Type")).toContain("application/json");

        const body = await res.json<Record<string, unknown>>();
        expect(body.code).toBe("METHOD_NOT_ALLOWED");
        expect(body.error).toBe(body.code);
        expect(body.allowedMethods).toEqual(["POST"]);
        expect(body.requestId).toBeTruthy();
    });
});
