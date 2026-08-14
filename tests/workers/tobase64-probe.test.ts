import { it, expect } from "vitest";

// Capability pin: src/services/screenshot.ts encodes PNG bytes with
// Uint8Array.prototype.toBase64 (web-standard, no Node Buffer). This asserts
// the API exists in workerd under this project's wrangler.toml compatibility
// settings, so a compat-date or runtime change that removes it fails loudly
// here instead of at request time.
it("Uint8Array.prototype.toBase64 exists in workerd", () => {
  const u8 = new Uint8Array([72, 101, 108, 108, 111]);
  expect(typeof u8.toBase64).toBe("function");
  expect(u8.toBase64()).toBe("SGVsbG8=");
});
