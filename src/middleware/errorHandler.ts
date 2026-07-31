/**
 * Global Error Handler Middleware
 * Provides consistent error response format for all errors
 * 
 * Requirements: 5.4
 * - Include error code, message, and requestId in all error responses
 * - Consistent error response format
 */

import type { Context } from "hono";
import type { ErrorCode, ErrorResponse } from "../types";
import { loggerFromEnv } from "../utils/logger";
import { getRequestId, getProcessingTime } from "./requestId";

/**
 * Map of error types to error codes
 */
const ERROR_CODE_MAP: Record<string, ErrorCode> = {
  // URL errors
  "Invalid URL": "INVALID_URL",
  "URL is required": "INVALID_URL",
  "Only HTTP/HTTPS URLs allowed": "INVALID_URL",
  "Internal URLs not allowed": "INVALID_URL",

  // Viewport errors
  "Viewport": "INVALID_VIEWPORT",
  "viewport": "INVALID_VIEWPORT",

  // TTL errors
  "TTL": "INVALID_TTL",
  "ttl": "INVALID_TTL",

  // Selector errors
  "selector": "INVALID_SELECTOR",
  "Selector": "INVALID_SELECTOR",
  "Element not found": "ELEMENT_NOT_FOUND",

  // Timeout errors
  timeout: "FETCH_TIMEOUT",
  Timeout: "FETCH_TIMEOUT",
  aborted: "FETCH_TIMEOUT",

  // Render errors
  Navigation: "RENDER_FAILED",
  "net::": "RENDER_FAILED",
  "Browser": "RENDER_FAILED",

  // Cache errors
  cache: "CACHE_ERROR",
  Cache: "CACHE_ERROR",

  // Payment errors
  payment: "PAYMENT_FAILED",
  Payment: "PAYMENT_FAILED",

  // Rate limit errors
  "rate limit": "RATE_LIMITED",
  "Rate limit": "RATE_LIMITED",
  "too many": "RATE_LIMITED",

  // Service errors
  unavailable: "SERVICE_UNAVAILABLE",
  Unavailable: "SERVICE_UNAVAILABLE",

  // ACV Errors
  "verification failed": "ACV_FAILED",
  "Proof verification": "ACV_FAILED",
};

/**
 * Determine error code from error message
 */
export function getErrorCode(message: string): ErrorCode {
  for (const [pattern, code] of Object.entries(ERROR_CODE_MAP)) {
    if (message.includes(pattern)) {
      return code;
    }
  }
  return "INTERNAL_ERROR";
}

/**
 * Determine HTTP status code from error code
 */
export function getHttpStatus(code: ErrorCode): number {
  switch (code) {
    case "INVALID_REQUEST":
    case "INVALID_URL":
    case "INVALID_VIEWPORT":
    case "INVALID_TTL":
    case "INVALID_SELECTOR":
    case "VALIDATION_ERROR":
    case "INVALID_CONTENT_TYPE":
    case "INVALID_JSON":
    case "MISSING_URL":
    case "REDIRECT_BLOCKED":
    case "MISSING_QUERY":
    case "QUERY_TOO_LONG":
    case "COMPARE_TOO_SMALL":
    case "COMPARE_TOO_LARGE":
    case "BATCH_TOO_SMALL":
    case "BATCH_TOO_LARGE":
    case "INVALID_PDF":
    case "PDF_TOO_LARGE":
    case "WEBHOOK_INVALID":
    case "MEMORY_VALUE_TOO_LARGE":
      return 400;
    case "AUTH_FAILED":
    case "REPLAY_DETECTED":
    case "MISSING_AUTH":
    case "INVALID_TIMESTAMP":
    case "EXPIRED_TIMESTAMP":
    case "INVALID_WALLET":
    case "INVALID_SIGNATURE":
    case "VERIFICATION_FAILED":
    case "UNAUTHORIZED":
      return 401;
    case "PAYMENT_FAILED":
      return 402;
    case "FORBIDDEN":
      return 403;
    case "ELEMENT_NOT_FOUND":
    case "MONITOR_NOT_FOUND":
    case "MEMORY_KEY_NOT_FOUND":
    case "NOT_FOUND":
      return 404;
    case "METHOD_NOT_ALLOWED":
      return 405;
    case "PAYLOAD_TOO_LARGE":
      return 413;
    case "ACV_FAILED":
      return 422;
    case "RATE_LIMITED":
      return 429;
    case "FETCH_TIMEOUT":
    case "RENDER_FAILED":
    case "FETCH_FAILED":
    case "FETCH_ALL_PROVIDERS_FAILED":
    case "RESEARCH_FAILED":
      return 502;
    case "SERVICE_UNAVAILABLE":
    case "AI_UNAVAILABLE":
      return 503;
    case "CACHE_ERROR":
    case "INTERNAL_ERROR":
    case "EXTRACTION_FAILED":
    case "INTEL_FAILED":
    default:
      return 500;
  }
}

/**
 * Create a consistent error response
 */
export function createErrorResponse(
  code: ErrorCode,
  message: string,
  requestId: string,
  retryAfter?: number
): ErrorResponse {
  return {
    error: code,
    code,
    message,
    requestId,
    ...(retryAfter !== undefined && { retryAfter }),
  };
}

/**
 * Global error handler — registered via `app.onError()` (the idiomatic Hono v4
 * mechanism). Unlike a `*` try/catch middleware, this catches errors thrown by
 * any middleware or handler regardless of registration order, and returns the
 * consistent error envelope.
 */
export function errorHandler(error: Error, c: Context): Response {
  const requestId = getRequestId(c);
  const processingTime = getProcessingTime(c);
  const message = error.message || "Unknown error";
  const code = getErrorCode(message);
  const status = getHttpStatus(code);

  // Log the unhandled error (previously invisible in production). Stack stays
  // server-side; it is never returned to the client.
  loggerFromEnv(c.env as { LOG_LEVEL?: string }, { requestId }).error("request.unhandled_error", {
    code,
    status,
    message,
    stack: error.stack,
  });

  // Determine if retry is appropriate
  const retryAfter = [502, 503, 429].includes(status) ? 5 : undefined;

  const errorResponse = createErrorResponse(code, message, requestId, retryAfter);

  // Set response headers
  c.header("X-Request-Id", requestId);
  c.header("X-Processing-Time", processingTime.toString());

  return c.json(errorResponse, status as 400 | 401 | 402 | 404 | 405 | 413 | 422 | 429 | 500 | 502 | 503);
}
