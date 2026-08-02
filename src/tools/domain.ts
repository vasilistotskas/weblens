/**
 * Domain Intelligence Handler
 * POST /domain — registration, DNS and what they imply, in one call.
 *
 * Replaces what would otherwise be a WHOIS/RDAP lookup, five DNS queries and
 * a pile of interpretation, from vendors who only sell it by the month.
 */

import type { Context } from "hono";
import type { z } from "zod/v4";
import { createErrorResponse } from "../middleware/errorHandler";
import type { DomainRequestSchema } from "../schemas";
import { inspectDomain, normalizeDomain } from "../services/domain-intel";
import type { Env } from "../types";

export async function domainHandler(c: Context<{ Bindings: Env }>) {
    const requestId = c.get("requestId");

    try {
        const { domain } = c.get("validatedBody") as z.infer<typeof DomainRequestSchema>;

        const normalized = normalizeDomain(domain);
        if (!normalized) {
            return c.json(
                createErrorResponse(
                    "INVALID_URL",
                    "Provide a public domain name, e.g. \"stripe.com\" (IP addresses and hostnames without a public suffix are not supported)",
                    requestId,
                ),
                400,
            );
        }

        const report = await inspectDomain(normalized, c.env);

        return c.json({
            ...report,
            inspectedAt: new Date().toISOString(),
            requestId,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        if (message.includes("timeout") || message.includes("aborted")) {
            return c.json(
                createErrorResponse("FETCH_TIMEOUT", "Registry or resolver did not respond in time", requestId),
                502,
            );
        }
        return c.json(createErrorResponse("INTERNAL_ERROR", message, requestId), 500);
    }
}
