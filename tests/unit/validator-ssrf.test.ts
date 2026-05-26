import { describe, it, expect } from "vitest";
import { isValidURL, validateURL } from "../../src/services/validator";

describe("SSRF validator — IP encoding canonicalization", () => {
    it("blocks loopback in every encoding", () => {
        expect(isValidURL("http://127.0.0.1/")).toBe(false); // canonical
        expect(isValidURL("http://0177.0.0.1/")).toBe(false); // octal octet
        expect(isValidURL("http://0x7f.0.0.1/")).toBe(false); // hex octet
        expect(isValidURL("http://127.1/")).toBe(false); // shorthand
        expect(isValidURL("http://2130706433/")).toBe(false); // bare 32-bit int
        expect(isValidURL("http://0x7f000001/")).toBe(false); // bare hex
    });

    it("blocks the cloud metadata service and private ranges", () => {
        expect(isValidURL("http://169.254.169.254/latest/meta-data/")).toBe(false);
        expect(isValidURL("http://10.0.0.5/")).toBe(false);
        expect(isValidURL("http://192.168.1.1/")).toBe(false);
        expect(isValidURL("http://172.16.0.1/")).toBe(false);
        expect(isValidURL("http://100.64.0.1/")).toBe(false); // CGNAT
    });

    it("blocks private ranges expressed in octal/hex/bare-int", () => {
        // The WHATWG URL parser canonicalizes numeric hosts; private targets in
        // any encoding normalize into a private dotted-quad and are blocked.
        expect(isValidURL("http://0xa.0.0.1/")).toBe(false); // 10.0.0.1 (hex first octet)
        expect(isValidURL("http://017700000001/")).toBe(false); // 127.0.0.1 (bare octal)
        expect(isValidURL("http://192.168.257/")).toBe(false); // 192.168.1.1 shorthand
    });

    it("blocks IPv6 loopback / link-local / ULA", () => {
        expect(isValidURL("http://[::1]/")).toBe(false);
        expect(isValidURL("http://[fe80::1]/")).toBe(false);
        expect(isValidURL("http://[fc00::1]/")).toBe(false);
    });

    it("allows ordinary public hosts (canonical dotted-quad + domains)", () => {
        expect(isValidURL("https://example.com/path")).toBe(true);
        expect(isValidURL("https://8.8.8.8/")).toBe(true); // canonical public IP
        expect(isValidURL("https://sub.domain.co.uk/x?y=1")).toBe(true);
    });

    it("still enforces scheme, credentials, and .onion rules", () => {
        expect(isValidURL("ftp://example.com/")).toBe(false);
        expect(isValidURL("https://user:pass@example.com/")).toBe(false);
        expect(isValidURL("http://abc.onion/")).toBe(false);
        expect(validateURL("https://example.com").normalized).toContain("example.com");
    });
});
