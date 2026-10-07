/**
 * `@x402/extensions` runs an advisory Ajv validation of every route's bazaar
 * extension, and Ajv compiles schemas with `new Function` — forbidden in
 * workerd. Unpatched, production logs an Ajv error + an x402 warning per paid
 * route per isolate (thousands a day). `patches/@x402__extensions@<ver>.patch`
 * skips validation on the codegen error instead.
 *
 * The patch is keyed to an exact version, so a dependency bump makes pnpm
 * reject the stale entry — and the tempting fix, deleting the entry, is what
 * the 2.24.0 → 2.28.0 bump did: install succeeded, the patch was gone, and the
 * spam was back in production the same day. These checks fail the build
 * instead: the entry must name the installed version, and the installed code
 * must actually carry the guard.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const CODEGEN_GUARD = "Code generation from strings";

const BAZAAR_ENTRY = require.resolve("@x402/extensions/bazaar");

/** The package's `exports` map hides `./package.json`, so walk up from an exported entry. */
function installedVersion(): string {
    let dir = dirname(BAZAAR_ENTRY);
    while (!existsSync(join(dir, "package.json"))) dir = dirname(dir);
    return (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string }).version;
}

describe("@x402/extensions workerd patch", () => {
    it("is registered for the installed version", () => {
        const workspace = readFileSync(
            fileURLToPath(new URL("../../pnpm-workspace.yaml", import.meta.url)),
            "utf8",
        );
        const version = installedVersion();
        expect(workspace).toContain(
            `'@x402/extensions@${version}': patches/@x402__extensions@${version}.patch`,
        );
    });

    it("is applied to the installed bazaar validator", () => {
        const source = readFileSync(BAZAAR_ENTRY, "utf8");
        expect(source).toContain(CODEGEN_GUARD);
        expect(source).toContain("logger: false");
    });
});
