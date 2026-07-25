import { describe, it, expect } from "vitest";
import { isAllowedBrowserRequest } from "../../src/utils/browser-guard";

describe("Browser page hardening — isAllowedBrowserRequest", () => {
    it("allows ordinary public https URLs", () => {
        expect(isAllowedBrowserRequest("https://example.com/page")).toBe(true);
    });

    it("allows non-network schemes (cannot reach internal hosts)", () => {
        expect(isAllowedBrowserRequest("data:text/html,hi")).toBe(true);
        expect(isAllowedBrowserRequest("about:blank")).toBe(true);
    });

    it("blocks the cloud metadata service", () => {
        expect(isAllowedBrowserRequest("http://169.254.169.254/latest/meta-data/")).toBe(false);
    });

    it("blocks loopback", () => {
        expect(isAllowedBrowserRequest("http://127.0.0.1/")).toBe(false);
    });

    it("blocks hex-encoded loopback", () => {
        expect(isAllowedBrowserRequest("https://0x7f000001/")).toBe(false);
    });

    it("blocks private RFC1918 ranges", () => {
        expect(isAllowedBrowserRequest("http://10.0.0.1/")).toBe(false);
    });
});
