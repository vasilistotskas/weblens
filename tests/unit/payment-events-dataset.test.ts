/**
 * wrangler.toml and PAYMENT_EVENTS_DATASETS must name the same Analytics
 * Engine datasets. The Worker writes to whatever wrangler.toml binds; the
 * funnel script reads whatever config.ts names. If they drift, the funnel
 * report silently reads an empty dataset and shows "no buyers".
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PAYMENT_EVENTS_DATASETS } from "../../src/config";

const toml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../wrangler.toml"), "utf8").replace(/\r\n/g, "\n");

/** The dataset bound to PAYMENT_EVENTS in a `[[<table>]]` block. */
function boundDataset(table: string): string | undefined {
    const block = new RegExp(`\\[\\[${table.replace(/\./g, "\\.")}\\]\\]\\nbinding = "PAYMENT_EVENTS"\\ndataset = "([^"]+)"`, "u");
    return block.exec(toml)?.[1];
}

describe("PAYMENT_EVENTS dataset names", () => {
    it("production binding matches config", () => {
        expect(boundDataset("analytics_engine_datasets")).toBe(PAYMENT_EVENTS_DATASETS.production);
    });

    it("testnet binding matches config", () => {
        expect(boundDataset("env.testnet.analytics_engine_datasets")).toBe(PAYMENT_EVENTS_DATASETS.testnet);
    });
});
