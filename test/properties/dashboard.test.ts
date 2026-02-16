import { describe, it, expect, vi, beforeEach } from "vitest";
import { dashboardHandler } from "../../src/tools/dashboard";

import { Context } from "hono";
import { Env } from "../../src/types";

describe("Dashboard UI", () => {
    let mockContext: Context<{ Bindings: Env }>;

    beforeEach(() => {
        mockContext = {
            html: vi.fn().mockImplementation((html) => html),
        } as unknown as Context<{ Bindings: Env }>;
    });

    it("should serve HTML content", async () => {
        const response = await dashboardHandler(mockContext);
        expect(mockContext.html).toHaveBeenCalled();
        expect(response).toContain("<!DOCTYPE html>");
        expect(response).toContain("<title>WebLens Agent Dashboard</title>");
    });

    it("should include wallet connection logic", async () => {
        const response = await dashboardHandler(mockContext);
        expect(response).toContain("createWalletClient");
        expect(response).toContain("window.ethereum");
    });

    it("should include credit endpoints", async () => {
        const response = await dashboardHandler(mockContext);
        expect(response).toContain("/credits/balance");
        expect(response).toContain("/credits/history");
        expect(response).toContain("/credits/buy");
    });
});
