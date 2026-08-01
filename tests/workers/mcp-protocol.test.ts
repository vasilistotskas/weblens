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
