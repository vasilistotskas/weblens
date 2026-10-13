/**
 * Company Profile Handler
 * POST /company — what a company sells, to whom, at what price, whether it is
 * hiring, and what it runs on, read live from its own site (services/company-profile.ts).
 *
 * Every failure answers with an error status, so a paid call that could not
 * produce a profile is cancelled (or its credit refunded) rather than sold.
 */

import type { Context } from "hono";
import type { z } from "zod/v4";
import { createErrorResponse } from "../middleware/errorHandler";
import type { CompanyRequestSchema } from "../schemas";
import { AIUnavailableError, isAIAvailable } from "../services/ai";
import {
    profileCompany,
    ProfileExtractionError,
    RobotsDisallowedError,
    SiteUnreachableError,
} from "../services/company-profile";
import { normalizeDomain } from "../services/domain-intel";
import type { AppEnv } from "../types";

export async function companyHandler(c: Context<AppEnv>) {
    const requestId = c.get("requestId");
    try {
        const { domain } = c.get("validatedBody") as z.infer<typeof CompanyRequestSchema>;

        const normalized = normalizeDomain(domain);
        if (!normalized) {
            return c.json(
                createErrorResponse("INVALID_URL", "Provide a public company domain, e.g. \"vercel.com\"", requestId),
                400,
            );
        }
        const anthropicKey = c.env.ANTHROPIC_API_KEY;
        if (!isAIAvailable(anthropicKey)) {
            return c.json(createErrorResponse("AI_UNAVAILABLE", "AI service not configured", requestId), 503);
        }

        const profile = await profileCompany(normalized, c.env, anthropicKey);
        return c.json({ ...profile, profiledAt: new Date().toISOString(), requestId });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        if (error instanceof RobotsDisallowedError) {
            return c.json(createErrorResponse("FORBIDDEN", message, requestId), 403);
        }
        if (error instanceof SiteUnreachableError) {
            return c.json(createErrorResponse("RENDER_FAILED", message, requestId), 502);
        }
        if (error instanceof AIUnavailableError) {
            return c.json(createErrorResponse("AI_UNAVAILABLE", message, requestId), 503);
        }
        if (error instanceof ProfileExtractionError) {
            return c.json(createErrorResponse("EXTRACTION_FAILED", message, requestId), 502);
        }
        return c.json(createErrorResponse("INTERNAL_ERROR", message, requestId), 500);
    }
}
