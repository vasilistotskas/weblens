/**
 * Preview + ERC-8004 handlers (all free, rate-limited where they do work).
 *
 * POST /preview                          — price + sample (+ live snippet)
 * GET  /receipts/:requestId              — receipt for a paid call
 * POST /feedback                         — host an ERC-8004 feedback document
 * GET  /feedback/:id                     — serve it back (the feedbackURI)
 * GET  /.well-known/agent-registration.json — ERC-8004 registration file
 */

import type { Context } from "hono";
import type { z } from "zod/v4";
import { createErrorResponse } from "../middleware/errorHandler";
import type { PreviewRequestSchema } from "../schemas";
import {
    buildRegistration,
    getFeedback,
    getReceipt,
    hostFeedback,
    missingFeedbackFields,
} from "../services/erc8004";
import {
    LIVE_PREVIEW_CHARS,
    LIVE_PREVIEW_ENDPOINTS,
    PREVIEW_SAMPLES,
    describePrice,
    isPaidEndpoint,
} from "../services/previews";
import { validateURL } from "../services/validator";
import type { Env } from "../types";
import { generateRequestId } from "../utils/requestId";
import { fetchBasicPage } from "./fetch-basic";

type AppContext = Context<{ Bindings: Env }>;

/**
 * Public origin for documents we publish. Forced to https for real hosts:
 * the ERC-8004 registration file and the feedbackURI are cited by third
 * parties, so advertising a plaintext URL would be both spec-wrong and a
 * downgrade vector. Local development keeps its scheme so it stays usable.
 */
function baseOf(c: AppContext): string {
    const url = new URL(c.req.url);
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return isLocal ? url.origin : `https://${url.host}`;
}

// ============================================
// POST /preview
// ============================================

export async function previewHandler(c: AppContext) {
    const requestId = c.get("requestId");

    try {
        const { endpoint, url } = c.get("validatedBody") as z.infer<typeof PreviewRequestSchema>;
        const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

        if (!isPaidEndpoint(path)) {
            return c.json(
                createErrorResponse("NOT_FOUND", `Unknown paid endpoint: ${path}. See /discovery for the catalogue.`, requestId),
                404,
            );
        }

        const entry = PREVIEW_SAMPLES[path];
        const canLive = LIVE_PREVIEW_ENDPOINTS.includes(path);

        // Live preview only where the marginal cost is a plain fetch — never
        // for a SerpAPI- or Anthropic-backed endpoint.
        let live: Record<string, unknown> | undefined;
        if (canLive && url) {
            const validation = validateURL(url);
            if (!validation.valid) {
                return c.json(
                    createErrorResponse("INVALID_URL", validation.error ?? "Invalid URL", requestId),
                    400,
                );
            }
            try {
                const page = await fetchBasicPage(validation.normalized ?? url, 10000);
                live = {
                    url: validation.normalized ?? url,
                    title: page.title,
                    content: page.content.slice(0, LIVE_PREVIEW_CHARS),
                    truncatedAt: LIVE_PREVIEW_CHARS,
                    note: `Live preview truncated to ${String(LIVE_PREVIEW_CHARS)} characters. The paid call returns the full document.`,
                };
            } catch (e) {
                live = { error: e instanceof Error ? e.message : "Preview fetch failed" };
            }
        }

        return c.json({
            endpoint: path,
            method: "POST",
            price: describePrice(path),
            currency: "USD",
            summary: entry?.summary,
            sample: entry?.sample,
            sampleType: "recorded",
            live,
            livePreviewAvailable: canLive,
            livePreviewHint: canLive
                ? "Pass a url to run a real, truncated preview of this endpoint for free."
                : "This endpoint calls a paid upstream provider, so free live previews are not offered — the recorded sample shows the exact response shape.",
            docs: `${baseOf(c)}/docs`,
            schema: `${baseOf(c)}/openapi.json`,
            previewedAt: new Date().toISOString(),
            requestId,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return c.json(createErrorResponse("INTERNAL_ERROR", message, requestId), 500);
    }
}

// ============================================
// ERC-8004
// ============================================

export function agentRegistrationHandler(c: AppContext) {
    return c.json(buildRegistration(baseOf(c)));
}

export async function receiptHandler(c: AppContext) {
    const requestId = c.get("requestId");
    const id = c.req.param("requestId") ?? "";

    const receipt = id === "" ? null : await getReceipt(c.env, id);
    if (!receipt) {
        return c.json(
            createErrorResponse("NOT_FOUND", "No receipt for that request id. Receipts are issued for paid calls and kept for 30 days.", requestId),
            404,
        );
    }
    return c.json(receipt);
}

export async function submitFeedbackHandler(c: AppContext) {
    const requestId = c.get("requestId");

    let document: Record<string, unknown>;
    try {
        document = await c.req.json<Record<string, unknown>>();
    } catch {
        return c.json(createErrorResponse("INVALID_JSON", "Invalid JSON body", requestId), 400);
    }

    if (typeof document !== "object" || Array.isArray(document)) {
        return c.json(
            createErrorResponse("VALIDATION_ERROR", "Body must be an ERC-8004 feedback document object", requestId),
            400,
        );
    }

    const missing = missingFeedbackFields(document);
    if (missing.length > 0) {
        return c.json(
            createErrorResponse(
                "VALIDATION_ERROR",
                `ERC-8004 feedback document is missing required field(s): ${missing.join(", ")}`,
                requestId,
            ),
            400,
        );
    }

    try {
        const id = generateRequestId();
        const hosted = await hostFeedback(c.env, baseOf(c), document, id);
        return c.json({
            ...hosted,
            hashAlgorithm: "keccak256",
            note: "Pass feedbackURI and feedbackHash to giveFeedback() on the ERC-8004 Reputation Registry. The document is stored verbatim; WebLens neither authors nor alters it.",
            requestId,
        }, 201);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return c.json(createErrorResponse("INTERNAL_ERROR", message, requestId), 500);
    }
}

export async function getFeedbackHandler(c: AppContext) {
    const requestId = c.get("requestId");
    const id = c.req.param("id") ?? "";
    const body = id === "" ? null : await getFeedback(c.env, id);
    if (body === null) {
        return c.json(createErrorResponse("NOT_FOUND", "No feedback document with that id", requestId), 404);
    }
    // Served verbatim so its keccak-256 hash matches what we returned.
    return c.body(body, 200, { "Content-Type": "application/json" });
}
