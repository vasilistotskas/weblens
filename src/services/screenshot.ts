/**
 * Screenshot Service
 * Captures webpage screenshots using Cloudflare Browser Rendering
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4
 */

import puppeteer from "@cloudflare/puppeteer";
import { VIEWPORT_BOUNDS, TIMEOUT_CONFIG } from "../config";
import type { ScreenshotRequest } from "../types";

export interface ScreenshotResult {
  image: string;  // Base64-encoded PNG
  dimensions: {
    width: number;
    height: number;
  };
  capturedAt: string;
}

/**
 * Clamp a value to a range
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Validate and normalize viewport dimensions
 */
export function normalizeViewport(viewport?: { width: number; height: number }): {
  width: number;
  height: number;
} {
  const width = viewport?.width 
    ? clamp(viewport.width, VIEWPORT_BOUNDS.width.min, VIEWPORT_BOUNDS.width.max)
    : VIEWPORT_BOUNDS.width.default;
  
  const height = viewport?.height
    ? clamp(viewport.height, VIEWPORT_BOUNDS.height.min, VIEWPORT_BOUNDS.height.max)
    : VIEWPORT_BOUNDS.height.default;

  return { width, height };
}

/**
 * Validate and normalize timeout
 */
export function normalizeTimeout(timeout?: number): number {
  if (!timeout) {
    return TIMEOUT_CONFIG.default;
  }
  return clamp(timeout, TIMEOUT_CONFIG.min, TIMEOUT_CONFIG.max);
}

/**
 * Capture a screenshot of a webpage
 * 
 * @param browserBinding - Cloudflare Browser Rendering binding
 * @param request - Screenshot request parameters
 * @returns Screenshot result with base64 image and metadata
 */
export async function captureScreenshot(
  browserBinding: Fetcher,
  request: ScreenshotRequest
): Promise<ScreenshotResult> {
  const viewport = normalizeViewport(request.viewport);
  const timeout = normalizeTimeout(request.timeout);

  const browser = await puppeteer.launch(browserBinding);
  
  try {
    const page = await browser.newPage();
    
    // Set viewport dimensions
    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
    });

    // Navigate to the URL with timeout
    await page.goto(request.url, {
      waitUntil: "networkidle0",
      timeout,
    });

    let screenshotBuffer: Buffer;
    let actualDimensions = viewport;

    if (request.selector) {
      // Capture specific element
      const element = await page.$(request.selector);
      if (!element) {
        throw new Error(`Element not found: ${request.selector}`);
      }
      
      screenshotBuffer = await element.screenshot({
        type: "png",
      }) as Buffer;

      // Get element dimensions
      const boundingBox = await element.boundingBox();
      if (boundingBox) {
        actualDimensions = {
          width: Math.round(boundingBox.width),
          height: Math.round(boundingBox.height),
        };
      }
    } else if (request.fullPage) {
      // Capture full page
      screenshotBuffer = await page.screenshot({
        type: "png",
        fullPage: true,
      }) as Buffer;

      // Get full page dimensions
      const bodyHandle = await page.$("body");
      if (bodyHandle) {
        const boundingBox = await bodyHandle.boundingBox();
        if (boundingBox) {
          actualDimensions = {
            width: Math.round(boundingBox.width),
            height: Math.round(boundingBox.height),
          };
        }
      }
    } else {
      // Capture viewport
      screenshotBuffer = await page.screenshot({
        type: "png",
      }) as Buffer;
    }

    // Convert to base64
    const base64Image = screenshotBuffer.toString("base64");

    return {
      image: base64Image,
      dimensions: actualDimensions,
      capturedAt: new Date().toISOString(),
    };
  } finally {
    await browser.close();
  }
}
