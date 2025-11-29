/**
 * PDF Service
 * Extracts text and metadata from PDF documents
 *
 * Requirements: 5.1, 5.3
 * - Download and extract text from PDF
 * - Extract text with page markers
 */

import type { PdfPage } from "../types";

export interface PdfMetadata {
  title?: string;
  author?: string;
  pageCount: number;
  createdAt?: string;
}

export interface PdfExtractResult {
  metadata: PdfMetadata;
  pages: PdfPage[];
  fullText: string;
}

/**
 * Custom error for invalid PDF
 */
export class InvalidPdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPdfError";
  }
}

/**
 * Custom error for PDF too large
 */
export class PdfTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfTooLargeError";
  }
}

const MAX_PDF_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Download PDF from URL
 */
async function downloadPdf(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/pdf,*/*",
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new InvalidPdfError(`Failed to download PDF: ${String(response.status)}`);
  }

  // Check content type
  const contentType = response.headers.get("content-type") ?? "";
  if (
    !contentType.includes("pdf") &&
    !contentType.includes("octet-stream") &&
    !url.toLowerCase().endsWith(".pdf")
  ) {
    throw new InvalidPdfError("URL does not point to a valid PDF document");
  }

  // Check size
  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_PDF_SIZE) {
    throw new PdfTooLargeError(
      `PDF exceeds maximum size of ${String(MAX_PDF_SIZE / 1024 / 1024)}MB`
    );
  }

  const buffer = await response.arrayBuffer();

  if (buffer.byteLength > MAX_PDF_SIZE) {
    throw new PdfTooLargeError(
      `PDF exceeds maximum size of ${String(MAX_PDF_SIZE / 1024 / 1024)}MB`
    );
  }

  return buffer;
}

/**
 * Simple PDF text extraction
 * Note: This is a basic implementation. For production, consider using
 * a proper PDF parsing library like pdf-parse or pdfjs-dist
 */
function extractTextFromPdf(buffer: ArrayBuffer): PdfExtractResult {
  const bytes = new Uint8Array(buffer);
  const text = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(bytes);

  // Check PDF signature
  if (!text.startsWith("%PDF")) {
    throw new InvalidPdfError("Invalid PDF format: missing PDF signature");
  }

  // Extract basic metadata from PDF
  const metadata = extractPdfMetadata(text);

  // Extract text content (simplified extraction)
  const pages = extractPdfPages(text);

  // Combine all page content
  const fullText = pages.map((p) => p.content).join("\n\n--- Page Break ---\n\n");

  return {
    metadata: {
      ...metadata,
      pageCount: pages.length || 1,
    },
    pages,
    fullText,
  };
}

/**
 * Extract metadata from PDF content
 */
function extractPdfMetadata(
  text: string
): Omit<PdfMetadata, "pageCount"> {
  const metadata: Omit<PdfMetadata, "pageCount"> = {};

  // Extract title
  const titleMatch = /\/Title\s*\(([^)]+)\)/.exec(text);
  if (titleMatch) {
    metadata.title = decodePdfString(titleMatch[1]);
  }

  // Extract author
  const authorMatch = /\/Author\s*\(([^)]+)\)/.exec(text);
  if (authorMatch) {
    metadata.author = decodePdfString(authorMatch[1]);
  }

  // Extract creation date
  const dateMatch = /\/CreationDate\s*\(D:(\d{14})/.exec(text);
  if (dateMatch) {
    const dateStr = dateMatch[1];
    const year = dateStr.slice(0, 4);
    const month = dateStr.slice(4, 6);
    const day = dateStr.slice(6, 8);
    metadata.createdAt = `${year}-${month}-${day}`;
  }

  return metadata;
}

/**
 * Extract pages from PDF content
 */
function extractPdfPages(text: string): PdfPage[] {
  const pages: PdfPage[] = [];

  // Find text streams in PDF
  const streamRegex = /stream\s*([\s\S]*?)\s*endstream/g;
  let match;
  let pageNumber = 1;

  while ((match = streamRegex.exec(text)) !== null) {
    const streamContent = match[1];

    // Try to extract readable text from stream
    const readableText = extractReadableText(streamContent);

    if (readableText.trim().length > 0) {
      pages.push({
        pageNumber,
        content: readableText.trim(),
      });
      pageNumber++;
    }
  }

  // If no pages extracted, try alternative extraction
  if (pages.length === 0) {
    const alternativeText = extractAlternativeText(text);
    if (alternativeText.trim().length > 0) {
      pages.push({
        pageNumber: 1,
        content: alternativeText.trim(),
      });
    }
  }

  return pages;
}

/**
 * Extract readable text from PDF stream
 */
function extractReadableText(stream: string): string {
  // Look for text between parentheses (PDF text objects)
  const textMatches = stream.match(/\(([^)]+)\)/g) ?? [];
  const texts = textMatches
    .map((m) => decodePdfString(m.slice(1, -1)))
    .filter((t) => t.length > 0 && /[a-zA-Z]/.test(t));

  return texts.join(" ");
}

/**
 * Alternative text extraction for PDFs without standard streams
 */
function extractAlternativeText(text: string): string {
  // Extract text from BT...ET blocks (text objects)
  const textBlocks: string[] = [];
  const btRegex = /BT\s*([\s\S]*?)\s*ET/g;
  let match;

  while ((match = btRegex.exec(text)) !== null) {
    const block = match[1];
    const textMatches = block.match(/\(([^)]+)\)/g) ?? [];
    const blockText = textMatches
      .map((m) => decodePdfString(m.slice(1, -1)))
      .join(" ");
    if (blockText.trim()) {
      textBlocks.push(blockText.trim());
    }
  }

  return textBlocks.join("\n");
}

/**
 * Decode PDF string escapes
 */
function decodePdfString(str: string): string {
  return str
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

/**
 * Extract text and metadata from a PDF URL
 */
export async function extractPdf(
  url: string,
  pages?: number[]
): Promise<PdfExtractResult> {
  // Download PDF
  const buffer = await downloadPdf(url);

  // Extract content
  const result = extractTextFromPdf(buffer);

  // Filter to specific pages if requested
  if (pages && pages.length > 0) {
    const filteredPages = result.pages.filter((p) =>
      pages.includes(p.pageNumber)
    );
    const filteredFullText = filteredPages
      .map((p) => p.content)
      .join("\n\n--- Page Break ---\n\n");

    return {
      ...result,
      pages: filteredPages,
      fullText: filteredFullText,
    };
  }

  return result;
}
