import path from "path";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

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
                plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.toml" } })],
                test: {
                    name: "workers",
                    include: ["tests/workers/**/*.test.ts"],
                },
            },
        ],
    },
});
