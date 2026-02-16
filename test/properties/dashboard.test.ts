import { describe, it, expect, vi, beforeEach } from "vitest";
import { dashboardHandler } from "../../src/tools/dashboard";

describe("Dashboard UI", () => {
    let mockContext: any;

    beforeEach(() => {
        mockContext = {
            html: vi.fn().mockImplementation((html) => html),
        };
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
