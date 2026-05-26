/**
 * PDF Extraction Endpoint Handler
 * Extracts text and metadata from PDF documents
 *
 * Requirements: 5.1, 5.5, 5.6
 * - POST /pdf with PDF URL
 * - Return text, metadata, and page structure
 */

import type { Context } from "hono";
import type { z } from "zod/v4";
import type { PdfRequestSchema } from "../schemas";
import {
  extractPdf,
  InvalidPdfError,
  PdfTooLargeError,
} from "../services/pdf";
import { validateURL } from "../services/validator";
import type { Env, PdfExtractResponse } from "../types";

/**
 * PDF extraction endpoint handler
 * POST /pdf
 */
export async function pdfHandler(c: Context<{ Bindings: Env }>) {
  const requestId = c.get("requestId");

  try {
    const { url, pages } = c.get("validatedBody") as z.infer<typeof PdfRequestSchema>;

    // Validate URL
    const urlValidation = validateURL(url);
    if (!urlValidation.valid) {
      return c.json(
        {
          error: "INVALID_URL",
          code: "INVALID_URL",
          message: urlValidation.error ?? "Invalid URL",
          requestId,
        },
        400
      );
    }

    // Extract PDF content
    const result = await extractPdf(urlValidation.normalized ?? url, pages);

    const response: PdfExtractResponse = {
      url,
      metadata: result.metadata,
      pages: result.pages,
      fullText: result.fullText,
      extractedAt: new Date().toISOString(),
      requestId,
    };

    return c.json(response);
  } catch (error) {
    // Handle PDF-specific errors
    if (error instanceof InvalidPdfError) {
      return c.json(
        {
          error: "INVALID_PDF",
          code: "INVALID_PDF",
          message: error.message,
          requestId,
        },
        400
      );
    }

    if (error instanceof PdfTooLargeError) {
      return c.json(
        {
          error: "PDF_TOO_LARGE",
          code: "PDF_TOO_LARGE",
          message: error.message,
          requestId,
        },
        400
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";

    // Check for timeout
    if (message.includes("timeout") || message.includes("aborted")) {
      return c.json(
        {
          error: "FETCH_TIMEOUT",
          code: "FETCH_TIMEOUT",
          message: "PDF download timed out",
          requestId,
        },
        502
      );
    }

    return c.json(
      {
        error: "INTERNAL_ERROR",
        code: "INTERNAL_ERROR",
        message,
        requestId,
      },
      500
    );
  }
}
