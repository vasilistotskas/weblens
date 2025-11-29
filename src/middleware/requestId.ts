/**
 * Request ID Middleware
 * Adds X-Request-Id and X-Processing-Time headers to all responses
 * 
 * Requirements: 5.3
 * - Include X-Request-Id header in all responses
 * - Track processing time for X-Processing-Time header
 */

import type { Context, Next } from "hono";
import { generateRequestId } from "../utils/requestId";

/**
 * Context key for storing request ID
 */
export const REQUEST_ID_KEY = "requestId";

/**
 * Context key for storing request start time
 */
export const REQUEST_START_TIME_KEY = "requestStartTime";

/**
 * Request ID middleware
 * Generates a unique request ID and tracks processing time
 * Adds X-Request-Id and X-Processing-Time headers to all responses
 */
export async function requestIdMiddleware(c: Context, next: Next) {
  // Generate request ID at the start
  const requestId = generateRequestId();
  const startTime = Date.now();

  // Store in context for use by handlers
  c.set(REQUEST_ID_KEY, requestId);
  c.set(REQUEST_START_TIME_KEY, startTime);

  // Process the request
  await next();

  // Calculate processing time
  const processingTime = Date.now() - startTime;

  // Add headers to response
  c.header("X-Request-Id", requestId);
  c.header("X-Processing-Time", processingTime.toString());
}

/**
 * Get request ID from context
 * Returns the request ID if set, or generates a new one
 */
export function getRequestId(c: Context): string {
  return (c.get(REQUEST_ID_KEY) as string | undefined) ?? generateRequestId();
}

/**
 * Get processing time from context
 * Returns the elapsed time since request start in milliseconds
 */
export function getProcessingTime(c: Context): number {
  const startTime = c.get(REQUEST_START_TIME_KEY) as number | undefined;
  if (startTime === undefined) {
    return 0;
  }
  return Date.now() - startTime;
}
