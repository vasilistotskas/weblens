/**
 * Screenshot Endpoint Handler
 * POST /screenshot - Capture a screenshot of a webpage
 *
 * Requirements: 1.1, 1.6
 */

import type { Context } from "hono";
import type { z } from "zod/v4";
import type { ScreenshotRequestSchema } from "../schemas";
import { captureScreenshot } from "../services/screenshot";
import { validateURL } from "../services/validator";
import type { Env, ScreenshotRequest, ScreenshotResponse, ErrorResponse } from "../types";

/**
 * Screenshot endpoint handler
 */
export async function screenshot(c: Context<{ Bindings: Env }>): Promise<Response> {
  const requestId = c.get("requestId");
  const startTime = Date.now();

  try {
    // Body is already validated + parsed by validateRequest(ScreenshotRequestSchema).
    const data = c.get("validatedBody") as z.infer<typeof ScreenshotRequestSchema>;

    // SSRF gate — same private/internal IP blocking applied to all scraping endpoints.
    const urlValidation = validateURL(data.url);
    if (!urlValidation.valid) {
      return c.json<ErrorResponse>({
        error: "INVALID_URL",
        code: "INVALID_URL",
        message: urlValidation.error ?? "Invalid URL",
        requestId,
      }, 400);
    }

    // Map the flat validated body onto the nested ScreenshotRequest the
    // screenshot service expects.
    const request: ScreenshotRequest = {
      url: urlValidation.normalized ?? data.url,
      viewport: { width: data.width, height: data.height },
      selector: data.selector,
      fullPage: data.fullPage,
      timeout: data.timeout,
    };

    // Check if browser binding is available
    if (!c.env.BROWSER) {
      return c.json<ErrorResponse>({
        error: "SERVICE_UNAVAILABLE",
        code: "SERVICE_UNAVAILABLE",
        message: "Browser rendering service is not available",
        requestId,
        retryAfter: 60,
      }, 503);
    }

    // Capture screenshot
    const result = await captureScreenshot(c.env.BROWSER, request);

    // Build response
    const response: ScreenshotResponse = {
      url: request.url,
      image: result.image,
      dimensions: result.dimensions,
      capturedAt: result.capturedAt,
      requestId,
    };

    // Set response headers
    const processingTime = Date.now() - startTime;

    return c.json(response, 200, {
      "X-Request-Id": requestId,
      "X-Processing-Time": processingTime.toString(),
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Handle specific errors
    if (errorMessage.includes("Element not found")) {
      return c.json<ErrorResponse>({
        error: "ELEMENT_NOT_FOUND",
        code: "ELEMENT_NOT_FOUND",
        message: errorMessage,
        requestId,
      }, 404, {
        "X-Request-Id": requestId,
        "X-Processing-Time": processingTime.toString(),
      });
    }

    if (errorMessage.includes("timeout") || errorMessage.includes("Timeout")) {
      return c.json<ErrorResponse>({
        error: "FETCH_TIMEOUT",
        code: "FETCH_TIMEOUT",
        message: "Target URL failed to respond within the timeout period",
        requestId,
        retryAfter: 5,
      }, 502, {
        "X-Request-Id": requestId,
        "X-Processing-Time": processingTime.toString(),
      });
    }

    // Generic error
    return c.json<ErrorResponse>({
      error: "RENDER_FAILED",
      code: "RENDER_FAILED",
      message: `Screenshot capture failed: ${errorMessage}`,
      requestId,
      retryAfter: 5,
    }, 502, {
      "X-Request-Id": requestId,
      "X-Processing-Time": processingTime.toString(),
    });
  }
}
