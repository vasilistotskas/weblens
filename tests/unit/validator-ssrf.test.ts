import { describe, it, expect } from "vitest";
import { validateURL } from "../../src/services/validator";

describe("SSRF validator — IP encoding canonicalization", () => {
    it("blocks loopback in every encoding", () => {
        expect(validateURL("http://127.0.0.1/").valid).toBe(false); // canonical
        expect(validateURL("http://0177.0.0.1/").valid).toBe(false); // octal octet
        expect(validateURL("http://0x7f.0.0.1/").valid).toBe(false); // hex octet
        expect(validateURL("http://127.1/").valid).toBe(false); // shorthand
        expect(validateURL("http://2130706433/").valid).toBe(false); // bare 32-bit int
        expect(validateURL("http://0x7f000001/").valid).toBe(false); // bare hex
    });

    it("blocks the cloud metadata service and private ranges", () => {
        expect(validateURL("http://169.254.169.254/latest/meta-data/").valid).toBe(false);
        expect(validateURL("http://10.0.0.5/").valid).toBe(false);
        expect(validateURL("http://192.168.1.1/").valid).toBe(false);
        expect(validateURL("http://172.16.0.1/").valid).toBe(false);
        expect(validateURL("http://100.64.0.1/").valid).toBe(false); // CGNAT
    });

    it("blocks private ranges expressed in octal/hex/bare-int", () => {
        // The WHATWG URL parser canonicalizes numeric hosts; private targets in
        // any encoding normalize into a private dotted-quad and are blocked.
        expect(validateURL("http://0xa.0.0.1/").valid).toBe(false); // 10.0.0.1 (hex first octet)
        expect(validateURL("http://017700000001/").valid).toBe(false); // 127.0.0.1 (bare octal)
        expect(validateURL("http://192.168.257/").valid).toBe(false); // 192.168.1.1 shorthand
    });

    it("blocks IPv6 loopback / link-local / ULA", () => {
        expect(validateURL("http://[::1]/").valid).toBe(false);
        expect(validateURL("http://[fe80::1]/").valid).toBe(false);
        expect(validateURL("http://[fc00::1]/").valid).toBe(false);
    });

    it("allows ordinary public hosts (canonical dotted-quad + domains)", () => {
        expect(validateURL("https://example.com/path").valid).toBe(true);
        expect(validateURL("https://8.8.8.8/").valid).toBe(true); // canonical public IP
        expect(validateURL("https://sub.domain.co.uk/x?y=1").valid).toBe(true);
    });

    it("still enforces scheme, credentials, and .onion rules", () => {
        expect(validateURL("ftp://example.com/").valid).toBe(false);
        expect(validateURL("https://user:pass@example.com/").valid).toBe(false);
        expect(validateURL("http://abc.onion/").valid).toBe(false);
        expect(validateURL("https://example.com").normalized).toContain("example.com");
    });
});
