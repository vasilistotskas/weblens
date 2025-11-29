/**
 * Screenshot Endpoint Handler
 * POST /screenshot - Capture a screenshot of a webpage
 * 
 * Requirements: 1.1, 1.6
 */

import type { Context } from "hono";
import type { Env, ScreenshotRequest, ScreenshotResponse, ErrorResponse } from "../types";
import { validateURL } from "../services/validator";
import { captureScreenshot } from "../services/screenshot";
import { generateRequestId } from "../utils/requestId";
import { VIEWPORT_BOUNDS, TIMEOUT_CONFIG } from "../config";

/**
 * Validate screenshot request parameters
 */
function validateRequest(body: unknown): { valid: true; data: ScreenshotRequest } | { valid: false; error: ErrorResponse; requestId: string } {
  const requestId = generateRequestId();
  
  if (!body || typeof body !== "object") {
    return {
      valid: false,
      requestId,
      error: {
        error: "INVALID_REQUEST",
        code: "INVALID_REQUEST" as const,
        message: "Request body must be a JSON object",
        requestId,
      },
    };
  }

  const req = body as Record<string, unknown>;

  // Validate URL
  if (!req.url || typeof req.url !== "string") {
    return {
      valid: false,
      requestId,
      error: {
        error: "INVALID_URL",
        code: "INVALID_URL",
        message: "URL is required and must be a string",
        requestId,
      },
    };
  }

  const urlValidation = validateURL(req.url);
  if (!urlValidation.valid) {
    return {
      valid: false,
      requestId,
      error: {
        error: "INVALID_URL",
        code: "INVALID_URL",
        message: urlValidation.error || "Invalid URL",
        requestId,
      },
    };
  }

  // Validate viewport if provided
  if (req.viewport !== undefined) {
    if (typeof req.viewport !== "object" || req.viewport === null) {
      return {
        valid: false,
        requestId,
        error: {
          error: "INVALID_VIEWPORT",
          code: "INVALID_VIEWPORT",
          message: "Viewport must be an object with width and height",
          requestId,
        },
      };
    }

    const viewport = req.viewport as Record<string, unknown>;
    
    if (viewport.width !== undefined && (typeof viewport.width !== "number" || viewport.width < VIEWPORT_BOUNDS.width.min || viewport.width > VIEWPORT_BOUNDS.width.max)) {
      return {
        valid: false,
        requestId,
        error: {
          error: "INVALID_VIEWPORT",
          code: "INVALID_VIEWPORT",
          message: `Viewport width must be between ${VIEWPORT_BOUNDS.width.min} and ${VIEWPORT_BOUNDS.width.max}`,
          requestId,
        },
      };
    }

    if (viewport.height !== undefined && (typeof viewport.height !== "number" || viewport.height < VIEWPORT_BOUNDS.height.min || viewport.height > VIEWPORT_BOUNDS.height.max)) {
      return {
        valid: false,
        requestId,
        error: {
          error: "INVALID_VIEWPORT",
          code: "INVALID_VIEWPORT",
          message: `Viewport height must be between ${VIEWPORT_BOUNDS.height.min} and ${VIEWPORT_BOUNDS.height.max}`,
          requestId,
        },
      };
    }
  }

  // Validate selector if provided
  if (req.selector !== undefined && typeof req.selector !== "string") {
    return {
      valid: false,
      requestId,
      error: {
        error: "INVALID_SELECTOR",
        code: "INVALID_SELECTOR",
        message: "Selector must be a string",
        requestId,
      },
    };
  }

  // Validate timeout if provided
  if (req.timeout !== undefined) {
    if (typeof req.timeout !== "number" || req.timeout < TIMEOUT_CONFIG.min || req.timeout > TIMEOUT_CONFIG.max) {
      return {
        valid: false,
        requestId,
        error: {
          error: "INVALID_REQUEST",
          code: "INTERNAL_ERROR",
          message: `Timeout must be between ${TIMEOUT_CONFIG.min} and ${TIMEOUT_CONFIG.max} milliseconds`,
          requestId,
        },
      };
    }
  }

  return {
    valid: true,
    data: {
      url: urlValidation.normalized!,
      viewport: req.viewport as ScreenshotRequest["viewport"],
      selector: req.selector as string | undefined,
      fullPage: req.fullPage === true,
      timeout: req.timeout as number | undefined,
    },
  };
}

/**
 * Screenshot endpoint handler
 */
export async function screenshot(c: Context<{ Bindings: Env }>): Promise<Response> {
  const requestId = generateRequestId();
  const startTime = Date.now();

  try {
    // Parse request body
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json<ErrorResponse>({
        error: "INVALID_REQUEST",
        code: "INTERNAL_ERROR",
        message: "Invalid JSON in request body",
        requestId,
      }, 400);
    }

    // Validate request
    const validation = validateRequest(body);
    if (!validation.valid) {
      return c.json(validation.error, 400);
    }

    const request = validation.data;

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
