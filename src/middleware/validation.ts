import type { Context, Next } from "hono";
import type { z } from "zod";
import { PAID_ENDPOINTS } from "../config";
import type { Env, Variables } from "../types";

/**
 * Validation Middleware
 *
 * Validates request body against a Zod schema.
 * - Returns 400 Bad Request if validation fails
 * - Strips unknown fields (strict validation)
 * - Returns structured error response
 * - EXCEPT for unauthenticated probes of paid endpoints, which fall through
 *   to the x402 402 challenge (see isUnpaidProbe)
 */

/**
 * Maximum accepted request body size. Enforced before any JSON parsing — both
 * here and in the cache-lookup middleware, whichever sees the body first.
 */
export const MAX_BODY_BYTES = 256 * 1024; // 256 KB

/**
 * True when the request targets a paid endpoint but carries neither an x402
 * payment nor credit auth. Such a request receives a 402 challenge from the
 * payment middleware no matter what its body contains — so rejecting it with
 * a 400 here would only hide the payment challenge from probing agents
 * (observed in production: thousands of bare POSTs bouncing as 400 and
 * concluding "not a payable resource"). Paying requests still get validation
 * errors before any money moves; the handler is unreachable on this path
 * because the payment middleware always 402s unpaid requests.
 */
function isUnpaidProbe(c: Context<{ Bindings: Env; Variables: Variables }>): boolean {
    return PAID_ENDPOINTS.includes(c.req.path)
        && c.req.header("Payment-Signature") === undefined
        && c.req.header("X-CREDIT-WALLET") === undefined;
}

/**
 * Create validation middleware that parses the request body against a Zod schema.
 * Sets `validatedBody` in Hono context on success; returns 400 on failure.
 */
export function validateRequest(schema: z.ZodType) {
    return async (c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) => {
        // Only validate JSON bodies for now
        // Future: support query params if needed
        const contentType = c.req.header("Content-Type");

        if (!contentType?.includes("application/json")) {
            // Paid endpoints expect JSON — but let unauthenticated probes
            // (often bare POSTs with no content-type) reach the 402.
            if ((c.req.method === "POST" || c.req.method === "PUT") && !isUnpaidProbe(c)) {
                return c.json({
                    error: "INVALID_CONTENT_TYPE",
                    message: "Content-Type must be application/json",
                    code: "INVALID_CONTENT_TYPE",
                    requestId: c.get("requestId"),
                }, 400);
            }
            await next();
            return;
        }

        // Reject oversized bodies before parsing to bound CPU/memory per
        // request. Applies to probes too — never buffer unbounded input.
        const contentLength = Number(c.req.header("Content-Length") ?? "0");
        if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
            return c.json({
                error: "PAYLOAD_TOO_LARGE",
                message: "Request body exceeds the 256KB limit",
                code: "PAYLOAD_TOO_LARGE",
                requestId: c.get("requestId"),
            }, 413);
        }

        // Only body parsing lives in the try — downstream (next) errors must
        // reach the global error handler, not be mislabeled INVALID_JSON.
        let body: unknown;
        try {
            body = await c.req.json();
        } catch (e) {
            if (isUnpaidProbe(c)) {
                await next();
                return;
            }
            c.get("log").warn("validation.json_parse_failed", {
                error: e instanceof Error ? e.message : String(e),
            });
            return c.json({
                error: "INVALID_JSON",
                message: "Invalid JSON body",
                code: "INVALID_JSON",
                requestId: c.get("requestId"),
            }, 400);
        }

        // Parse and strip unknown fields
        const result = schema.safeParse(body);

        if (!result.success) {
            if (isUnpaidProbe(c)) {
                await next();
                return;
            }
            const formattedErrors = result.error.issues.map((err) => ({
                field: err.path.join("."),
                message: err.message,
                code: err.code
            }));

            // Which field a caller got wrong is the only way to tell a broken
            // client from a broken contract — /preview alone rejects ~870
            // bodies a week and the logs could not say why. Field paths and
            // Zod codes only: the submitted values are caller data and may
            // carry credentials, so they are never logged.
            c.get("log").info("request.validation.failed", {
                fields: formattedErrors.map((e) => `${e.field || "<root>"}:${e.code}`),
            });

            return c.json({
                error: "VALIDATION_ERROR",
                message: "Request body failed validation",
                details: formattedErrors,
                code: "VALIDATION_ERROR",
                requestId: c.get("requestId"),
            }, 400);
        }

        // Replace request body with validated data (stripped of unknown fields)
        c.set("validatedBody", result.data);

        await next();
    };
}
