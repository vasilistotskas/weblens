/**
 * Intelligence Endpoint Handlers
 * Knowledge Arbitrageur — Premium intelligence products
 *
 * POST /intel/company   - Company deep dive ($0.50)
 * POST /intel/market    - Market research report ($2.00)
 * POST /intel/competitive - Competitive analysis ($3.00)
 * POST /intel/site-audit  - Full site audit ($0.30)
 */

import type { Context } from "hono";
import { z } from "zod/v4";
import { isAIAvailable, handleAIError, AIUnavailableError } from "../services/ai";
import {
    companyIntel,
    marketResearch,
    competitiveAnalysis,
    siteAudit,
} from "../services/intel";
import type { Env } from "../types";
import { generateRequestId } from "../utils/requestId";

// ============================================
// Validation Schemas
// ============================================

export const companySchema = z.object({
    target: z.string().min(1).max(200),
});

export const marketSchema = z.object({
    topic: z.string().min(1).max(500),
    depth: z.enum(["quick", "standard", "comprehensive"]).default("standard"),
    focus: z.string().max(200).optional(),
});

export const competitiveSchema = z.object({
    company: z.string().min(1).max(200),
    maxCompetitors: z.number().min(1).max(10).default(5),
    focus: z.string().max(200).optional(),
});

export const siteAuditSchema = z.object({
    url: z.url().refine((url) => url.startsWith("http") && url.includes("://"), {
        message: "URL must be a valid HTTP/HTTPS URL with '://'",
    }),
});

// ============================================
// Helpers
// ============================================

/**
 * Validates that the AI service is configured and returns the API key.
 * Returns the API key string if available, or a 503 Response if not.
 */
function getAIKeyOrError(
    c: Context<{ Bindings: Env }>,
    requestId: string,
): string | Response {
    const apiKey = c.env.ANTHROPIC_API_KEY;
    if (!isAIAvailable(apiKey)) {
        return c.json(
            {
                error: "AI_UNAVAILABLE",
                code: "AI_UNAVAILABLE",
                message: "AI service not configured. Set ANTHROPIC_API_KEY for intelligence endpoints.",
                requestId,
            },
            503,
        );
    }
    return apiKey;
}

function handleIntelError(c: Context<{ Bindings: Env }>, error: unknown, requestId: string) {
    if (error instanceof AIUnavailableError) {
        const aiError = handleAIError(error);
        return c.json(
            {
                error: aiError.code,
                code: aiError.code,
                message: aiError.message,
                requestId,
                retryAfter: aiError.retryable ? 30 : undefined,
            },
            aiError.status as 400 | 500 | 503,
        );
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json(
        {
            error: "INTEL_FAILED",
            code: "INTEL_FAILED",
            message,
            requestId,
        },
        500,
    );
}

// ============================================
// POST /intel/company
// ============================================

export async function intelCompanyHandler(c: Context<{ Bindings: Env }>) {
    const requestId = generateRequestId();

    try {
        const body: unknown = await c.req.json();
        const parsed = companySchema.safeParse(body);

        if (!parsed.success) {
            return c.json(
                {
                    error: "INVALID_REQUEST",
                    code: "INVALID_REQUEST",
                    message: "Invalid request parameters",
                    requestId,
                    details: parsed.error.issues,
                },
                400,
            );
        }

        const apiKeyOrError = getAIKeyOrError(c, requestId);
        if (typeof apiKeyOrError !== "string") {
            return apiKeyOrError;
        }

        const profile = await companyIntel({
            target: parsed.data.target,
            aiConfig: { apiKey: apiKeyOrError },
        });

        return c.json({
            ...profile,
            analyzedAt: new Date().toISOString(),
            requestId,
        });
    } catch (error) {
        return handleIntelError(c, error, requestId);
    }
}

// ============================================
// POST /intel/market
// ============================================

export async function intelMarketHandler(c: Context<{ Bindings: Env }>) {
    const requestId = generateRequestId();

    try {
        const body: unknown = await c.req.json();
        const parsed = marketSchema.safeParse(body);

        if (!parsed.success) {
            return c.json(
                {
                    error: "INVALID_REQUEST",
                    code: "INVALID_REQUEST",
                    message: "Invalid request parameters",
                    requestId,
                    details: parsed.error.issues,
                },
                400,
            );
        }

        const apiKeyOrError = getAIKeyOrError(c, requestId);
        if (typeof apiKeyOrError !== "string") {
            return apiKeyOrError;
        }

        const report = await marketResearch({
            topic: parsed.data.topic,
            depth: parsed.data.depth,
            focus: parsed.data.focus,
            aiConfig: { apiKey: apiKeyOrError },
        });

        return c.json({
            ...report,
            depth: parsed.data.depth,
            researchedAt: new Date().toISOString(),
            requestId,
        });
    } catch (error) {
        return handleIntelError(c, error, requestId);
    }
}

// ============================================
// POST /intel/competitive
// ============================================

export async function intelCompetitiveHandler(c: Context<{ Bindings: Env }>) {
    const requestId = generateRequestId();

    try {
        const body: unknown = await c.req.json();
        const parsed = competitiveSchema.safeParse(body);

        if (!parsed.success) {
            return c.json(
                {
                    error: "INVALID_REQUEST",
                    code: "INVALID_REQUEST",
                    message: "Invalid request parameters",
                    requestId,
                    details: parsed.error.issues,
                },
                400,
            );
        }

        const apiKeyOrError = getAIKeyOrError(c, requestId);
        if (typeof apiKeyOrError !== "string") {
            return apiKeyOrError;
        }

        const report = await competitiveAnalysis({
            company: parsed.data.company,
            maxCompetitors: parsed.data.maxCompetitors,
            focus: parsed.data.focus,
            aiConfig: { apiKey: apiKeyOrError },
        });

        return c.json({
            ...report,
            analyzedAt: new Date().toISOString(),
            requestId,
        });
    } catch (error) {
        return handleIntelError(c, error, requestId);
    }
}

// ============================================
// POST /intel/site-audit
// ============================================

export async function intelSiteAuditHandler(c: Context<{ Bindings: Env }>) {
    const requestId = generateRequestId();

    try {
        const body: unknown = await c.req.json();
        const parsed = siteAuditSchema.safeParse(body);

        if (!parsed.success) {
            return c.json(
                {
                    error: "INVALID_REQUEST",
                    code: "INVALID_REQUEST",
                    message: "Invalid request parameters",
                    requestId,
                    details: parsed.error.issues,
                },
                400,
            );
        }

        const apiKeyOrError = getAIKeyOrError(c, requestId);
        if (typeof apiKeyOrError !== "string") {
            return apiKeyOrError;
        }

        const audit = await siteAudit({
            url: parsed.data.url,
            aiConfig: { apiKey: apiKeyOrError },
        });

        return c.json({
            ...audit,
            auditedAt: new Date().toISOString(),
            requestId,
        });
    } catch (error) {
        return handleIntelError(c, error, requestId);
    }
}
