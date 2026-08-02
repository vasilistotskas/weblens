/**
 * Package Intelligence Handler
 * POST /package — should I depend on this? npm and PyPI, one call.
 */

import type { Context } from "hono";
import type { z } from "zod/v4";
import { createErrorResponse } from "../middleware/errorHandler";
import type { PackageRequestSchema } from "../schemas";
import { inspectPackage, normalizePackageName } from "../services/package-intel";
import type { Env } from "../types";

export async function packageHandler(c: Context<{ Bindings: Env }>) {
    const requestId = c.get("requestId");

    try {
        const { name, registry } = c.get("validatedBody") as z.infer<typeof PackageRequestSchema>;

        const normalized = normalizePackageName(name, registry);
        if (!normalized) {
            return c.json(
                createErrorResponse(
                    "VALIDATION_ERROR",
                    `"${name}" is not a valid ${registry} package name`,
                    requestId,
                ),
                400,
            );
        }

        const report = await inspectPackage(normalized, registry);
        if (!report.found) {
            return c.json(
                createErrorResponse("NOT_FOUND", `No package "${normalized}" on ${registry}`, requestId),
                404,
            );
        }

        return c.json({ ...report, checkedAt: new Date().toISOString(), requestId });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        if (message.includes("timeout") || message.includes("aborted")) {
            return c.json(
                createErrorResponse("FETCH_TIMEOUT", "Registry did not respond in time", requestId),
                502,
            );
        }
        return c.json(createErrorResponse("INTERNAL_ERROR", message, requestId), 500);
    }
}
