import { describe, it, expect } from "vitest";
import { validateURL } from "../../src/services/validator";

describe("validateURL — userinfo SSRF defense", () => {
    it("rejects URL with username", () => {
        const result = validateURL("https://admin@example.com/");
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/credentials/iu);
    });

    it("rejects URL with username + password", () => {
        const result = validateURL("https://user:pass@example.com/");
        expect(result.valid).toBe(false);
    });

    it("rejects URL where userinfo could hide an internal target", () => {
        // Some HTTP clients normalize this ambiguously. Refuse outright.
        const result = validateURL("https://169.254.169.254@example.com/");
        expect(result.valid).toBe(false);
    });

    it("rejects URL with empty userinfo but `:` separator", () => {
        const result = validateURL("https://:pw@example.com/");
        expect(result.valid).toBe(false);
    });

    it("accepts a plain URL without userinfo", () => {
        const result = validateURL("https://example.com/path");
        expect(result.valid).toBe(true);
    });

    it("still rejects internal IPs (regression check)", () => {
        expect(validateURL("http://169.254.169.254/").valid).toBe(false);
        expect(validateURL("http://127.0.0.1/").valid).toBe(false);
        expect(validateURL("http://10.0.0.1/").valid).toBe(false);
        expect(validateURL("http://192.168.1.1/").valid).toBe(false);
    });

    it("rejects non-HTTP protocols", () => {
        expect(validateURL("file:///etc/passwd").valid).toBe(false);
        expect(validateURL("ftp://example.com/").valid).toBe(false);
    });
});
