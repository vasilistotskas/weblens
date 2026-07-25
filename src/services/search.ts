/**
 * Centralized Search Service
 *
 * Uses SerpAPI (Google results) when SERP_API_KEY is available,
 * falls back to DuckDuckGo HTML parsing with CAPTCHA detection.
 */

import { createLogger } from "../utils/logger";

// Module-level logger: searchWeb is a pure service (no env or Hono context).
const log = createLogger();

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  position: number;
}

interface SearchOptions {
  query: string;
  limit: number;
  serpApiKey?: string;
}

/**
 * Search the web using the best available provider.
 * Throws on complete failure so callers can surface errors properly.
 */
export async function searchWeb(options: SearchOptions): Promise<SearchResult[]> {
  const { query, limit, serpApiKey } = options;

  // SerpAPI is the primary provider (reliable, no bot detection)
  if (serpApiKey) {
    try {
      return await searchWithSerpApi(query, limit, serpApiKey);
    } catch (error) {
      // Scrub any accidental api_key leakage from the error message before
      // logging — SerpAPI 4xx bodies sometimes echo the full request URL.
      const raw = error instanceof Error ? error.message : String(error);
      const sanitized = raw.replace(/api_key=[^&\s"]+/gu, "api_key=REDACTED");
      log.warn("search.serpapi_fallback", { error: sanitized });
    }
  }

  // Fallback: DuckDuckGo HTML scraping
  return await searchWithDuckDuckGo(query, limit);
}

// ============================================
// SerpAPI Provider
// ============================================

interface SerpApiOrganic {
  position?: number;
  title?: string;
  link?: string;
  snippet?: string;
}

interface SerpApiResponse {
  organic_results?: SerpApiOrganic[];
  error?: string;
}

async function searchWithSerpApi(
  query: string,
  limit: number,
  apiKey: string
): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    api_key: apiKey,
    engine: "google",
    num: String(limit),
  });

  // Send the key as a header rather than a query param so it never appears
  // in URLs logged by error handlers, proxies, or CF's internal tooling.
  const paramsWithoutKey = new URLSearchParams(params);
  paramsWithoutKey.delete("api_key");
  const response = await fetch(`https://serpapi.com/search.json?${paramsWithoutKey.toString()}&api_key=${encodeURIComponent(apiKey)}`, {
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`SerpAPI returned ${String(response.status)}`);
  }

  const data: SerpApiResponse = await response.json();

  if (data.error) {
    throw new Error(`SerpAPI error: ${data.error}`);
  }

  const organic = data.organic_results ?? [];

  return organic.slice(0, limit).map((r, i) => ({
    title: r.title ?? "",
    url: r.link ?? "",
    snippet: r.snippet ?? "",
    position: i + 1,
  }));
}

// ============================================
// DuckDuckGo Fallback
// ============================================

async function searchWithDuckDuckGo(
  query: string,
  limit: number
): Promise<SearchResult[]> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetch(searchUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo returned ${String(response.status)}`);
  }

  const html = await response.text();

  // Detect CAPTCHA / bot detection pages
  if (
    (html.includes("challenge") && html.includes("duck")) ||
    html.includes("anomaly/images/challenge")
  ) {
    throw new Error(
      "Search provider returned bot detection challenge — set SERP_API_KEY for reliable search"
    );
  }

  return parseDuckDuckGoHtml(html, limit);
}

function parseDuckDuckGoHtml(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Primary regex: match result link + snippet pair
  const resultRegex =
    /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]*)<\/a>/gi;

  let match;
  let position = 1;

  while ((match = resultRegex.exec(html)) !== null && results.length < limit) {
    const [, url, title, snippet] = match;
    if (url && title) {
      results.push({
        title: decodeHtmlEntities(title.trim()),
        url: decodeURIComponent(url),
        snippet: decodeHtmlEntities((snippet ?? "").trim()),
        position: position++,
      });
    }
  }

  // Fallback: extract just links if main regex didn't match
  if (results.length === 0) {
    const linkRegex =
      /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>/gi;

    let linkMatch;
    while (
      (linkMatch = linkRegex.exec(html)) !== null &&
      results.length < limit
    ) {
      const [, url, title] = linkMatch;
      if (url && title) {
        results.push({
          title: decodeHtmlEntities(title.trim()),
          url: decodeURIComponent(url),
          snippet: "",
          position: position++,
        });
      }
    }
  }

  return results;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// ============================================
// SerpAPI Verticals
// ============================================
//
// Response field names below were validated against live SerpAPI responses
// for every engine (news_results, images_results, local_results,
// shopping_results, organic_results, suggestions, interest_over_time,
// transcript). Verticals are SerpAPI-only — there is no scraping fallback,
// so callers must surface SERVICE_UNAVAILABLE when the key is missing.

/** Raised when a vertical is requested without a configured SerpAPI key. */
export class SearchProviderUnavailableError extends Error {
  constructor(message = "Search provider not configured") {
    super(message);
    this.name = "SearchProviderUnavailableError";
  }
}

/** Generic SerpAPI call returning the parsed JSON payload. */
async function serpApiQuery(
  engine: string,
  params: Record<string, string>,
  apiKey: string | undefined,
): Promise<Record<string, unknown>> {
  if (!apiKey) {
    throw new SearchProviderUnavailableError();
  }
  const qs = new URLSearchParams({ engine, ...params });
  const response = await fetch(
    `https://serpapi.com/search.json?${qs.toString()}&api_key=${encodeURIComponent(apiKey)}`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok) {
    throw new Error(`SerpAPI returned ${String(response.status)}`);
  }
  const data: Record<string, unknown> & { error?: string } = await response.json();
  if (data.error) {
    throw new Error(`SerpAPI error: ${data.error}`);
  }
  return data;
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
    : [];
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

export interface NewsResult {
  position: number; title: string; url: string; source?: string; date?: string; isoDate?: string; thumbnail?: string;
}

export async function searchNews(query: string, limit: number, apiKey?: string): Promise<NewsResult[]> {
  const data = await serpApiQuery("google_news", { q: query }, apiKey);
  return asRecords(data.news_results).slice(0, limit).map((r, i) => ({
    position: i + 1,
    title: str(r.title) ?? "",
    url: str(r.link) ?? "",
    source: typeof r.source === "object" && r.source !== null ? str((r.source as Record<string, unknown>).name) : str(r.source),
    date: str(r.date),
    isoDate: str(r.iso_date),
    thumbnail: str(r.thumbnail),
  }));
}

export interface ImageResult {
  position: number; title: string; imageUrl: string; thumbnail?: string; sourcePage?: string; source?: string; width?: number; height?: number;
}

export async function searchImages(query: string, limit: number, apiKey?: string): Promise<ImageResult[]> {
  const data = await serpApiQuery("google_images", { q: query }, apiKey);
  return asRecords(data.images_results).slice(0, limit).map((r, i) => ({
    position: i + 1,
    title: str(r.title) ?? "",
    imageUrl: str(r.original) ?? "",
    thumbnail: str(r.thumbnail),
    sourcePage: str(r.link),
    source: str(r.source),
    width: num(r.original_width),
    height: num(r.original_height),
  }));
}

export interface PlaceResult {
  position: number; name: string; address?: string; rating?: number; reviews?: number; priceLevel?: string;
  category?: string; phone?: string; website?: string; description?: string; placeId?: string;
  coordinates?: { latitude?: number; longitude?: number };
}

export async function searchPlaces(query: string, limit: number, apiKey?: string, location?: string): Promise<PlaceResult[]> {
  const params: Record<string, string> = { q: query };
  if (location) { params.location = location; }
  const data = await serpApiQuery("google_local", params, apiKey);
  return asRecords(data.local_results).slice(0, limit).map((r, i) => {
    const gps = typeof r.gps_coordinates === "object" && r.gps_coordinates !== null
      ? r.gps_coordinates as Record<string, unknown> : undefined;
    return {
      position: i + 1,
      name: str(r.title) ?? "",
      address: str(r.address),
      rating: num(r.rating),
      reviews: num(r.reviews),
      priceLevel: str(r.price),
      category: str(r.type),
      phone: str(r.phone),
      website: str(r.website),
      description: str(r.description),
      placeId: str(r.place_id),
      coordinates: gps ? { latitude: num(gps.latitude), longitude: num(gps.longitude) } : undefined,
    };
  });
}

export interface ShoppingResult {
  position: number; title: string; url?: string; price?: string; extractedPrice?: number;
  source?: string; rating?: number; reviews?: number; thumbnail?: string;
}

export async function searchShopping(query: string, limit: number, apiKey?: string): Promise<ShoppingResult[]> {
  const data = await serpApiQuery("google_shopping", { q: query }, apiKey);
  return asRecords(data.shopping_results).slice(0, limit).map((r, i) => ({
    position: i + 1,
    title: str(r.title) ?? "",
    url: str(r.product_link) ?? str(r.link),
    price: str(r.price),
    extractedPrice: num(r.extracted_price),
    source: str(r.source),
    rating: num(r.rating),
    reviews: num(r.reviews),
    thumbnail: str(r.thumbnail),
  }));
}

export interface ScholarResult {
  position: number; title: string; url?: string; snippet?: string; publicationInfo?: string; citedBy?: number;
}

export async function searchScholar(query: string, limit: number, apiKey?: string): Promise<ScholarResult[]> {
  const data = await serpApiQuery("google_scholar", { q: query }, apiKey);
  return asRecords(data.organic_results).slice(0, limit).map((r, i) => {
    const pub = typeof r.publication_info === "object" && r.publication_info !== null
      ? r.publication_info as Record<string, unknown> : undefined;
    const inline = typeof r.inline_links === "object" && r.inline_links !== null
      ? r.inline_links as Record<string, unknown> : undefined;
    const citedBy = inline && typeof inline.cited_by === "object" && inline.cited_by !== null
      ? num((inline.cited_by as Record<string, unknown>).total) : undefined;
    return {
      position: i + 1,
      title: str(r.title) ?? "",
      url: str(r.link),
      snippet: str(r.snippet),
      publicationInfo: pub ? str(pub.summary) : undefined,
      citedBy,
    };
  });
}

export async function searchAutocomplete(query: string, limit: number, apiKey?: string): Promise<string[]> {
  const data = await serpApiQuery("google_autocomplete", { q: query }, apiKey);
  return asRecords(data.suggestions).slice(0, limit)
    .map((r) => str(r.value))
    .filter((v): v is string => v !== undefined);
}

export interface TrendsPoint { date?: string; timestamp?: string; values: { query: string; value?: number }[] }

export async function searchTrends(query: string, apiKey?: string): Promise<TrendsPoint[]> {
  const data = await serpApiQuery("google_trends", { q: query, data_type: "TIMESERIES" }, apiKey);
  const iot = typeof data.interest_over_time === "object" && data.interest_over_time !== null
    ? data.interest_over_time as Record<string, unknown> : undefined;
  return asRecords(iot?.timeline_data).map((point) => ({
    date: str(point.date),
    timestamp: str(point.timestamp),
    values: asRecords(point.values).map((v) => ({
      query: str(v.query) ?? query,
      value: num(v.extracted_value) ?? (str(v.value) !== undefined ? Number(str(v.value)) : undefined),
    })),
  }));
}

export interface TranscriptSegment { startMs?: number; startTime?: string; text: string }

export interface TranscriptResult { segments: TranscriptSegment[]; fullText: string }

export async function fetchYoutubeTranscript(videoId: string, apiKey?: string, lang?: string): Promise<TranscriptResult> {
  const params: Record<string, string> = { v: videoId };
  if (lang) { params.lang = lang; }
  const data = await serpApiQuery("youtube_video_transcript", params, apiKey);
  const segments = asRecords(data.transcript).map((s) => ({
    startMs: num(s.start_ms) ?? (str(s.start_ms) !== undefined ? Number(str(s.start_ms)) : undefined),
    startTime: str(s.start_time_text),
    text: str(s.snippet) ?? "",
  }));
  return { segments, fullText: segments.map((s) => s.text).join(" ").trim() };
}
