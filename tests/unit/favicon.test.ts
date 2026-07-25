/**
 * Favicon asset integrity: the embedded base64 payloads must decode to real
 * ICO/PNG files (x402scan's origin checker and browsers both fetch them),
 * and the SVG must be a valid standalone document.
 */

import { describe, expect, it } from "vitest";
import { FAVICON_SVG, faviconIcoHandler, faviconPngHandler } from "../../src/tools/favicon";

type HandlerContext = Parameters<typeof faviconIcoHandler>[0];

function mockContext() {
    return {
        body: (data: ArrayBuffer | string, status: number, headers: Record<string, string>) => ({
            data: typeof data === "string" ? data : new Uint8Array(data),
            status,
            headers,
        }),
    } as unknown as HandlerContext;
}

describe("favicon assets", () => {
    it("serves a valid standalone SVG", () => {
        expect(FAVICON_SVG.startsWith("<svg")).toBe(true);
        expect(FAVICON_SVG).toContain('xmlns="http://www.w3.org/2000/svg"');
        expect(FAVICON_SVG).toContain("#60a5fa"); // brand blue
        expect(FAVICON_SVG.trim().endsWith("</svg>")).toBe(true);
    });

    it("serves a real ICO (magic bytes + multi-size directory)", () => {
        const res = faviconIcoHandler(mockContext()) as unknown as {
            data: Uint8Array; status: number; headers: Record<string, string>;
        };
        expect(res.status).toBe(200);
        expect(res.headers["Content-Type"]).toBe("image/x-icon");
        // ICONDIR: reserved=0, type=1 (icon), count>=3 (16/32/48)
        expect(res.data[0]).toBe(0);
        expect(res.data[1]).toBe(0);
        expect(res.data[2]).toBe(1);
        expect(res.data[3]).toBe(0);
        expect(res.data[4]).toBeGreaterThanOrEqual(3);
    });

    it("serves a real PNG (magic bytes)", () => {
        const res = faviconPngHandler(mockContext()) as unknown as {
            data: Uint8Array; status: number; headers: Record<string, string>;
        };
        expect(res.status).toBe(200);
        expect(res.headers["Content-Type"]).toBe("image/png");
        expect(Array.from(res.data.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    });
});
