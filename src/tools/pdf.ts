/**
 * PDF Extraction Endpoint Handler
 * Extracts text and metadata from PDF documents
 *
 * Requirements: 5.1, 5.5, 5.6
 * - POST /pdf with PDF URL
 * - Return text, metadata, and page structure
 */

import type { Context } from "hono";
import { z } from "zod/v4";
import type { Env, PdfExtractRequest, PdfExtractResponse } from "../types";
import { generateRequestId } from "../utils/requestId";
import { validateURL } from "../services/validator";
import {
  extractPdf,
  InvalidPdfError,
  PdfTooLargeError,
} from "../services/pdf";

const pdfSchema = z.object({
  url: z.string(),
  pages: z.array(z.number().int().positive()).optional(),
});

/**
 * PDF extraction endpoint handler
 * POST /pdf
 */
export async function pdfHandler(c: Context<{ Bindings: Env }>) {
  const requestId = generateRequestId();

  try {
    const body = await c.req.json<PdfExtractRequest>();
    const parsed = pdfSchema.safeParse(body);

    if (!parsed.success) {
      return c.json(
        {
          error: "INVALID_REQUEST",
          code: "INVALID_REQUEST",
          message: "Invalid request parameters",
          requestId,
          details: parsed.error.issues,
        },
        400
      );
    }

    const { url, pages } = parsed.data;

    // Validate URL
    const urlValidation = validateURL(url);
    if (!urlValidation.valid) {
      return c.json(
        {
          error: "INVALID_URL",
          code: "INVALID_URL",
          message: urlValidation.error || "Invalid URL",
          requestId,
        },
        400
      );
    }

    // Extract PDF content
    const result = await extractPdf(urlValidation.normalized || url, pages);

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
