/**
 * Unit tests for extractVideoId (src/tools/youtube-transcript.ts).
 *
 * The /social/youtube/transcript endpoint accepts either a bare 11-char video
 * ID or any YouTube URL form (watch, youtu.be, shorts, mobile). These tests
 * pin the accepted forms and the rejections.
 */

import { describe, expect, it } from "vitest";
import { extractVideoId } from "../../src/tools/youtube-transcript";

const ID = "dQw4w9WgXcQ";

describe("extractVideoId", () => {
    it("accepts a bare 11-character video ID", () => {
        expect(extractVideoId(ID)).toBe(ID);
    });

    it("accepts a standard watch URL", () => {
        expect(extractVideoId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    });

    it("accepts a youtu.be short link", () => {
        expect(extractVideoId(`https://youtu.be/${ID}`)).toBe(ID);
    });

    it("accepts a shorts URL", () => {
        expect(extractVideoId(`https://youtube.com/shorts/${ID}`)).toBe(ID);
    });

    it("accepts a mobile watch URL", () => {
        expect(extractVideoId(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID);
    });

    it("trims surrounding whitespace", () => {
        expect(extractVideoId(`  ${ID}  `)).toBe(ID);
    });

    it("rejects plain text that is not a video reference", () => {
        expect(extractVideoId("not a video")).toBeNull();
    });

    it("rejects non-YouTube URLs", () => {
        expect(extractVideoId("https://vimeo.com/12345")).toBeNull();
    });

    it("rejects IDs that are not exactly 11 characters", () => {
        expect(extractVideoId(ID.slice(0, 10))).toBeNull();
        expect(extractVideoId(`https://www.youtube.com/watch?v=${ID.slice(0, 10)}`)).toBeNull();
        expect(extractVideoId(`https://youtu.be/${ID.slice(0, 10)}`)).toBeNull();
    });
});
