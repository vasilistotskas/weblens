/**
 * The structured logger's record shape. Workers Logs index each line by its
 * `event`, so a field that renamed the line hid it from every query: the
 * Stripe webhook logged `{ event: "charge.refunded" }` and its
 * `billing.payment_reversed` line could not be found.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../src/utils/logger";

describe("createLogger", () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it("keeps its own level, event and timestamp when a field has the same name", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        createLogger("debug", { requestId: "req_1" }).warn("billing.payment_reversed", { event: "charge.refunded", level: "info", ts: "never", reversedMicros: 5 });

        const line = JSON.parse(String(warn.mock.calls[0]?.[0])) as Record<string, unknown>;
        expect(line).toMatchObject({ level: "warn", event: "billing.payment_reversed", requestId: "req_1", reversedMicros: 5 });
        expect(line.ts).not.toBe("never");
    });
});
