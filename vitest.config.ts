import path from "path";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The workers project must see what CI sees: wrangler.toml and nothing from a
// developer's .env. Real credentials there change which code paths run (a CDP
// key puts CDP in the facilitator chain), so tests could pass locally and fail
// in CI. Documented switch: developers.cloudflare.com/workers/configuration/environment-variables/
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";

export default defineConfig({
    test: {
        projects: [
            // Pure-logic unit/property tests run fast in Node. Production modules
            // that import `cloudflare:workers` (the DurableObject base class) are
            // aliased to a lightweight stub.
            {
                test: {
                    name: "node",
                    include: ["tests/**/*.test.ts"],
                    exclude: ["tests/workers/**", "**/node_modules/**"],
                    alias: {
                        "cloudflare:workers": path.resolve(__dirname, "./tests/mocks/cloudflare-workers.ts"),
                    },
                    globals: true,
                },
            },
            // Binding / Durable-Object tests run inside the real workerd runtime via
            // the Workers Vitest pool, with real KV + DO instances from wrangler.toml.
            {
                plugins: [cloudflareTest({
                    wrangler: { configPath: "./wrangler.toml" },
                    // A partner secret, so tests/workers/partner.test.ts can call as the Apify partner.
                    miniflare: { bindings: { APIFY_PARTNER_SECRET: "test-partner-secret" } },
                })],
                test: {
                    name: "workers",
                    include: ["tests/workers/**/*.test.ts"],
                    setupFiles: ["./tests/workers/setup.ts"],
                },
            },
        ],
    },
});
