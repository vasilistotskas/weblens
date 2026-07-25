/**
 * YouTube Transcript Endpoint Handler
 * POST /social/youtube/transcript
 *
 * One SerpAPI youtube_video_transcript call. Accepts a bare video ID or any
 * full YouTube URL (watch, shorts, youtu.be).
 */

import type { Context } from "hono";
import type { z } from "zod/v4";
import { createErrorResponse } from "../middleware/errorHandler";
import type { YoutubeTranscriptRequestSchema } from "../schemas";
import { SearchProviderUnavailableError, fetchYoutubeTranscript } from "../services/search";
import type { Env } from "../types";

/** Extract the 11-char video ID from a bare ID or any YouTube URL form. */
export function extractVideoId(input: string): string | null {
    const trimmed = input.trim();
    if (/^[A-Za-z0-9_-]{11}$/u.test(trimmed)) {
        return trimmed;
    }
    try {
        const url = new URL(trimmed);
        const host = url.hostname.toLowerCase().replace(/^www\./u, "");
        if (host === "youtu.be") {
            const id = url.pathname.split("/").find(Boolean);
            return id && /^[A-Za-z0-9_-]{11}$/u.test(id) ? id : null;
        }
        if (host.endsWith("youtube.com")) {
            const v = url.searchParams.get("v");
            if (v && /^[A-Za-z0-9_-]{11}$/u.test(v)) { return v; }
            const parts = url.pathname.split("/").filter(Boolean);
            if ((parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live") && parts[1]
                && /^[A-Za-z0-9_-]{11}$/u.test(parts[1])) {
                return parts[1];
            }
        }
        return null;
    } catch {
        return null;
    }
}

export async function youtubeTranscriptHandler(c: Context<{ Bindings: Env }>) {
    const requestId = c.get("requestId");
    try {
        const { videoId: rawId, lang } = c.get("validatedBody") as z.infer<typeof YoutubeTranscriptRequestSchema>;

        const videoId = extractVideoId(rawId);
        if (!videoId) {
            return c.json(
                createErrorResponse("VALIDATION_ERROR", "videoId must be an 11-character YouTube video ID or a YouTube video URL", requestId),
                400,
            );
        }

        const transcript = await fetchYoutubeTranscript(videoId, c.env.SERP_API_KEY, lang);
        if (transcript.segments.length === 0) {
            return c.json(
                createErrorResponse("NOT_FOUND", "No transcript available for this video", requestId),
                404,
            );
        }

        return c.json({
            videoId,
            language: lang,
            segments: transcript.segments,
            fullText: transcript.fullText,
            fetchedAt: new Date().toISOString(),
            requestId,
        });
    } catch (error) {
        if (error instanceof SearchProviderUnavailableError) {
            return c.json(
                createErrorResponse("SERVICE_UNAVAILABLE", "Transcript provider not configured", requestId),
                503,
            );
        }
        const message = error instanceof Error ? error.message : "Unknown error";
        if (message.includes("SerpAPI")) {
            return c.json(
                createErrorResponse("SERVICE_UNAVAILABLE", "Transcript provider temporarily unavailable", requestId),
                502,
            );
        }
        return c.json(createErrorResponse("INTERNAL_ERROR", message, requestId), 500);
    }
}
