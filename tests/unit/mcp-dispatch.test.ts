/**
 * How a `tools/call` reaches the tool's own endpoint.
 *
 * It used to be `fetch(new URL(c.req.url).origin + endpoint)` — the Worker
 * fetching its own hostname. WebLens serves a Cloudflare Custom Domain, where
 * that returns 522, so in production *every* tool call answered
 * `{"error":{"code":522}}`, free tools included, while `initialize` and
 * `tools/list` kept working and the MCP registry listing looked healthy.
 *
 * A live probe cannot pin this: from a test runner (or any other origin) the
 * self-`fetch` reaches the real api.weblens.dev over the network and looks
 * fine. So the invariant is pinned at the seam instead — dispatch goes through
 * the injected dispatcher, and there is no `fetch` fallback to regress to.
 */

import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { setMcpDispatcher, TOOL_ENDPOINTS } from "../../src/tools/mcp";
import { mcpPostHandler } from "../../src/tools/mcp";

function callTool(name: string, args: Record<string, unknown> = {}) {
    const app = new Hono();
    app.post("/mcp", mcpPostHandler);

    return app.request("https://api.weblens.dev/mcp", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Payment-Signature": "sig-payload",
            "X-CREDIT-WALLET": "0xwallet",
            "X-CREDIT-SIGNATURE": "0xcreditsig",
            "X-CREDIT-TIMESTAMP": "1234567890",
            "cf-connecting-ip": "203.0.113.7",
            "X-Not-Forwarded": "nope",
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name, arguments: args },
        }),
    });
}

type RpcBody = {
    result?: { content: { text: string }[] };
    error?: { code: number; message: string; data?: Record<string, unknown> };
};

describe("MCP tool dispatch", () => {
    beforeEach(() => {
        setMcpDispatcher(undefined);
    });

    it("fails loudly with no dispatcher instead of falling back to fetch", async () => {
        const body = await (await callTool("preview_endpoint", { endpoint: "/fetch/basic" })).json() as RpcBody;

        // A `fetch` fallback would surface a connection/522 error instead.
        expect(body.error?.code).toBe(-32603);
        expect(body.error?.message).toContain("MCP dispatcher not registered");
    });

    it("dispatches to the tool's own endpoint, same origin, right method", async () => {
        const seen: { url: string; method: string }[] = [];
        setMcpDispatcher((request) => {
            seen.push({ url: request.url, method: request.method });
            return new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        });

        await callTool("search_web", { query: "x402" });

        expect(seen).toHaveLength(1);
        expect(seen[0].url).toBe("https://api.weblens.dev/search");
        expect(seen[0].method).toBe("POST");
    });

    it("forwards every credential a paid endpoint can authenticate", async () => {
        let headers: Headers | undefined;
        setMcpDispatcher((request) => {
            headers = request.headers;
            return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
        });

        await callTool("fetch_webpage", { url: "https://example.com" });

        // x402 payload…
        expect(headers?.get("Payment-Signature")).toBe("sig-payload");
        // …and the credit-account trio, which used not to be forwarded at all,
        // so a funded credit wallet could not spend through MCP.
        expect(headers?.get("X-CREDIT-WALLET")).toBe("0xwallet");
        expect(headers?.get("X-CREDIT-SIGNATURE")).toBe("0xcreditsig");
        expect(headers?.get("X-CREDIT-TIMESTAMP")).toBe("1234567890");
        // The edge IP keeps free-tier rate limiting per-caller rather than
        // lumping every MCP call into one "unknown" bucket.
        expect(headers?.get("cf-connecting-ip")).toBe("203.0.113.7");
        // Nothing else rides along.
        expect(headers?.get("X-Not-Forwarded")).toBeNull();
    });

    it("passes the tool arguments through as the request body", async () => {
        let body: string | undefined;
        setMcpDispatcher(async (request) => {
            body = await request.text();
            return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
        });

        await callTool("fetch_webpage", { url: "https://example.com", timeout: 9000 });

        expect(JSON.parse(body ?? "null")).toEqual({ url: "https://example.com", timeout: 9000 });
    });

    it("surfaces the endpoint's own error envelope, not a bare body", async () => {
        setMcpDispatcher(() =>
            new Response(
                JSON.stringify({ error: "INVALID_REQUEST", code: "INVALID_REQUEST", message: "url is required" }),
                { status: 400, headers: { "Content-Type": "application/json" } }
            )
        );

        const body = await (await callTool("fetch_webpage", {})).json() as RpcBody;

        expect(body.error?.code).toBe(400);
        expect(body.error?.message).toBe("INVALID_REQUEST: url is required");
    });

    it("routes no tool back at /mcp, which would recurse", () => {
        for (const [name, config] of Object.entries(TOOL_ENDPOINTS)) {
            expect(config?.endpoint, name).not.toBe("/mcp");
        }
    });
});
