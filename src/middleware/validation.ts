import type { Context, Next } from "hono";
import type { z } from "zod";
import type { Env, Variables } from "../types";

/**
 * Validation Middleware
 * 
 * Validates request body against a Zod schema.
 * - Returns 400 Bad Request if validation fails
 * - Strips unknown fields (strict validation)
 * - Returns structured error response
 */

/**
 * Create validation middleware that parses the request body against a Zod schema.
 * Sets `validatedBody` in Hono context on success; returns 400 on failure.
 */
export function validateRequest(schema: z.ZodType) {
    return async (c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) => {
        try {
            // Only validate JSON bodies for now
            // Future: support query params if needed
            const contentType = c.req.header("Content-Type");

            if (!contentType?.includes("application/json")) {
                // Skip validation for non-JSON requests (or enforce JSON?)
                // For paid endpoints, we expect JSON.
                if (c.req.method === "POST" || c.req.method === "PUT") {
                    return c.json({
                        error: "Invalid Content-Type",
                        message: "Content-Type must be application/json",
                        code: "INVALID_CONTENT_TYPE",
                        requestId: c.get("requestId"),
                    }, 400);
                }
                await next();
                return;
            }

            // Reject oversized bodies before parsing to bound CPU/memory per request.
            const MAX_BODY_BYTES = 256 * 1024; // 256 KB
            const contentLength = Number(c.req.header("Content-Length") ?? "0");
            if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
                return c.json({
                    error: "PAYLOAD_TOO_LARGE",
                    message: "Request body exceeds the 256KB limit",
                    code: "PAYLOAD_TOO_LARGE",
                    requestId: c.get("requestId"),
                }, 413);
            }

            const body: unknown = await c.req.json();

            // Parse and strip unknown fields
            const result = schema.safeParse(body);

            if (!result.success) {
                const formattedErrors = result.error.issues.map((err) => ({
                    field: err.path.join("."),
                    message: err.message,
                    code: err.code
                }));

                return c.json({
                    error: "Validation Error",
                    message: "Request body failed validation",
                    details: formattedErrors,
                    code: "VALIDATION_ERROR",
                    requestId: c.get("requestId"),
                }, 400);
            }

            // Replace request body with validated data (stripped of unknown fields)
            c.set("validatedBody", result.data);

            await next();
        } catch (e) {
            console.error("Validation Middleware Error:", e);
            return c.json({
                error: "Bad Request",
                message: "Invalid JSON body",
                code: "INVALID_JSON",
                requestId: c.get("requestId"),
            }, 400);
        }
    };
}
