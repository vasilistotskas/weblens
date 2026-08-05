/**
 * Project Audit Handler
 * POST /intel/project — off-chain due diligence on a project's web presence.
 */

import type { Context } from "hono";
import type { z } from "zod/v4";
import { createErrorResponse } from "../middleware/errorHandler";
import type { ProjectAuditRequestSchema } from "../schemas";
import { auditProject } from "../services/project-audit";
import type { Env } from "../types";

export async function projectAuditHandler(c: Context<{ Bindings: Env }>) {
    const requestId = c.get("requestId");

    try {
        const { domain, tokenAddress, chain } =
            c.get("validatedBody") as z.infer<typeof ProjectAuditRequestSchema>;

        const audit = await auditProject(domain, c.env, tokenAddress, chain);
        if (!audit) {
            return c.json(
                createErrorResponse(
                    "INVALID_URL",
                    `"${domain}" is not a public domain name. Pass the project's website, e.g. "example.org" or "https://example.org".`,
                    requestId,
                ),
                400,
            );
        }

        return c.json({ ...audit, auditedAt: new Date().toISOString(), requestId });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        if (message.includes("timeout") || message.includes("aborted")) {
            return c.json(
                createErrorResponse("FETCH_TIMEOUT", "The project site did not respond in time", requestId),
                502,
            );
        }
        return c.json(createErrorResponse("INTEL_FAILED", message, requestId), 500);
    }
}
