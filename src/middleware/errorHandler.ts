/**
 * Global Error Handler Middleware
 * Provides consistent error response format for all errors
 * 
 * Requirements: 5.4
 * - Include error code, message, and requestId in all error responses
 * - Consistent error response format
 */

import type { Context, Next } from "hono";
import type { ErrorCode, ErrorResponse } from "../types";
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
      return 400;
    case "PAYMENT_FAILED":
      return 402;
    case "ELEMENT_NOT_FOUND":
      return 404;
    case "RATE_LIMITED":
      return 429;
    case "FETCH_TIMEOUT":
    case "RENDER_FAILED":
      return 502;
    case "SERVICE_UNAVAILABLE":
      return 503;
    case "CACHE_ERROR":
    case "INTERNAL_ERROR":
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
 * Global error handler middleware
 * Catches all errors and returns consistent error responses
 */
export async function errorHandlerMiddleware(c: Context, next: Next) {
  try {
    await next();
  } catch (error) {
    const requestId = getRequestId(c);
    const processingTime = getProcessingTime(c);
    const message = error instanceof Error ? error.message : "Unknown error";
    const code = getErrorCode(message);
    const status = getHttpStatus(code);

    // Determine if retry is appropriate
    const retryAfter = [502, 503, 429].includes(status) ? 5 : undefined;

    const errorResponse = createErrorResponse(code, message, requestId, retryAfter);

    // Set response headers
    c.header("X-Request-Id", requestId);
    c.header("X-Processing-Time", processingTime.toString());

    return c.json(errorResponse, status as 400 | 402 | 404 | 429 | 500 | 502 | 503);
  }
}

/**
 * Helper to throw a typed error that will be caught by the error handler
 */
export class WebLensError extends Error {
  code: ErrorCode;
  retryAfter?: number;

  constructor(code: ErrorCode, message: string, retryAfter?: number) {
    super(message);
    this.code = code;
    this.retryAfter = retryAfter;
    this.name = "WebLensError";
  }
}
