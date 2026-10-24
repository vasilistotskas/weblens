/**
 * Search Service: Serper for Google search and its verticals, SerpAPI for
 * Google Trends and YouTube transcripts (which Serper does not offer).
 *
 * There is deliberately no scraping fallback: a paying caller must never
 * silently receive degraded results. A missing key raises
 * SearchProviderUnavailableError (503) and a provider failure raises
 * SearchUpstreamError (502), so the paid request fails, its settlement is
 * cancelled and any credit debit is refunded.
 *
 * Serper (google.serper.dev, `POST /{type}` with `X-API-KEY`) answers with a
 * results array per type (`organic`, `news`, `images`, `places`, `shopping`,
 * `suggestions`) and reports errors as `{message, statusCode}` with a non-2xx
 * status — "Not enough credits" is a 400, a bad key a 403. Field names below
 * were checked against live Serper responses for each type (2026-10-24), and
 * SerpAPI's (interest_over_time, transcript) against live SerpAPI responses.
 */

import { PAID_UPSTREAMS, SEARCH_PROVIDERS } from "../config";
import { asRecords, isRecord, num, str } from "../utils/narrow";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  position: number;
}

interface SearchOptions {
  query: string;
  limit: number;
  serperApiKey?: string;
}

/** Raised when search is requested without a configured provider key. */
export class SearchProviderUnavailableError extends Error {
  constructor(message = "Search provider not configured") {
    super(message);
    this.name = "SearchProviderUnavailableError";
  }
}

/** Raised when the search provider answers with an error or a non-2xx status. */
export class SearchUpstreamError extends Error {
  constructor(readonly status: number | undefined, detail: string) {
    // SerpAPI error bodies can echo the request URL, key included.
    super(`Search provider error: ${detail.replace(/api_key=[^&\s"]+/gu, "api_key=REDACTED")}`);
    this.name = "SearchUpstreamError";
  }
}

/** The Serper search types WebLens sells. */
type SerperType = "search" | "news" | "images" | "places" | "shopping" | "scholar" | "autocomplete";

/** One Serper call, returning the parsed JSON payload. */
async function serperQuery(
  type: SerperType,
  body: Record<string, string | number>,
  apiKey: string | undefined,
): Promise<Record<string, unknown>> {
  if (!apiKey) {
    throw new SearchProviderUnavailableError();
  }
  const response = await fetch(`${PAID_UPSTREAMS.serper}/${type}`, {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SEARCH_PROVIDERS.timeoutMs),
  });
  const data: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = isRecord(data) ? str(data.message) : undefined;
    throw new SearchUpstreamError(response.status, `HTTP ${String(response.status)}${message ? `: ${message}` : ""}`);
  }
  if (!isRecord(data)) {
    throw new SearchUpstreamError(undefined, "response is not a JSON object");
  }
  return data;
}

/**
 * Up to `limit` results of one Serper type. Serper answers at most
 * SEARCH_PROVIDERS.serperResultsPerPage results a call (asking for more still
 * returns 10, measured 2026-10-24), so a larger limit fetches further pages,
 * one credit each; pages do not overlap.
 */
async function serperResults(
  type: "search" | "places" | "scholar",
  body: Record<string, string | number>,
  field: string,
  limit: number,
  apiKey: string | undefined,
): Promise<Record<string, unknown>[]> {
  const perPage = SEARCH_PROVIDERS.serperResultsPerPage;
  const pages = Array.from({ length: Math.ceil(limit / perPage) }, (_, i) => i + 1);
  const answers = await Promise.all(pages.map((page) => serperQuery(type, page === 1 ? body : { ...body, page }, apiKey)));
  return answers.flatMap((data) => asRecords(data[field])).slice(0, limit);
}

/** One SerpAPI call, returning the parsed JSON payload. */
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
    `${PAID_UPSTREAMS.serpApiSearch}?${qs.toString()}&api_key=${encodeURIComponent(apiKey)}`,
    { signal: AbortSignal.timeout(SEARCH_PROVIDERS.timeoutMs) },
  );
  if (!response.ok) {
    throw new SearchUpstreamError(response.status, `HTTP ${String(response.status)}`);
  }
  const data: unknown = await response.json();
  if (!isRecord(data)) {
    throw new SearchUpstreamError(undefined, "response is not a JSON object");
  }
  // A search with no results is still a successful search: SerpApi sets
  // search_metadata.status to "Success" and puts "Google hasn't returned any
  // results for this query." in the top-level `error`
  // (serpapi.com/search-errors). Only status "Error" is a failed search.
  const status = isRecord(data.search_metadata) ? str(data.search_metadata.status) : undefined;
  const error = str(data.error);
  if (error && status !== "Success") {
    throw new SearchUpstreamError(undefined, error);
  }
  return data;
}

/** Web search: Google organic results. */
export async function searchWeb({ query, limit, serperApiKey }: SearchOptions): Promise<SearchResult[]> {
  const organic = await serperResults("search", { q: query, num: Math.min(limit, SEARCH_PROVIDERS.serperResultsPerPage) }, "organic", limit, serperApiKey);
  return organic.map((r, i) => ({
    title: str(r.title) ?? "",
    url: str(r.link) ?? "",
    snippet: str(r.snippet) ?? "",
    position: i + 1,
  }));
}

export interface NewsResult {
  position: number; title: string; url: string; snippet?: string; source?: string; date?: string; thumbnail?: string;
}

export async function searchNews(query: string, limit: number, apiKey?: string): Promise<NewsResult[]> {
  // Serper's news type answers at most one page of 10 (a second page comes back empty).
  const data = await serperQuery("news", { q: query, num: Math.min(limit, SEARCH_PROVIDERS.serperResultsPerPage) }, apiKey);
  return asRecords(data.news).slice(0, limit).map((r, i) => ({
    position: i + 1,
    title: str(r.title) ?? "",
    url: str(r.link) ?? "",
    snippet: str(r.snippet),
    source: str(r.source),
    date: str(r.date),
    thumbnail: str(r.imageUrl),
  }));
}

export interface ImageResult {
  position: number; title: string; imageUrl: string; thumbnail?: string; sourcePage?: string; source?: string; width?: number; height?: number;
}

export async function searchImages(query: string, limit: number, apiKey?: string): Promise<ImageResult[]> {
  const data = await serperQuery("images", { q: query, num: limit }, apiKey);
  return asRecords(data.images).slice(0, limit).map((r, i) => ({
    position: i + 1,
    title: str(r.title) ?? "",
    imageUrl: str(r.imageUrl) ?? "",
    thumbnail: str(r.thumbnailUrl),
    sourcePage: str(r.link),
    source: str(r.source),
    width: num(r.imageWidth),
    height: num(r.imageHeight),
  }));
}

export interface PlaceResult {
  position: number; name: string; address?: string; rating?: number; reviews?: number; priceLevel?: string;
  category?: string; phone?: string; website?: string; cid?: string;
  coordinates?: { latitude?: number; longitude?: number };
}

export async function searchPlaces(query: string, limit: number, apiKey?: string, location?: string): Promise<PlaceResult[]> {
  const body: Record<string, string | number> = { q: query };
  if (location) { body.location = location; }
  const places = await serperResults("places", body, "places", limit, apiKey);
  return places.map((r, i) => {
    const latitude = num(r.latitude);
    const longitude = num(r.longitude);
    return {
      position: i + 1,
      name: str(r.title) ?? "",
      address: str(r.address),
      rating: num(r.rating),
      reviews: num(r.ratingCount),
      priceLevel: str(r.priceLevel),
      category: str(r.category),
      phone: str(r.phoneNumber),
      website: str(r.website),
      cid: str(r.cid),
      coordinates: latitude === undefined && longitude === undefined ? undefined : { latitude, longitude },
    };
  });
}

export interface ShoppingResult {
  position: number; title: string; url?: string; price?: string; delivery?: string;
  source?: string; rating?: number; reviews?: number; thumbnail?: string;
}

export async function searchShopping(query: string, limit: number, apiKey?: string): Promise<ShoppingResult[]> {
  const data = await serperQuery("shopping", { q: query }, apiKey);
  return asRecords(data.shopping).slice(0, limit).map((r, i) => ({
    position: i + 1,
    title: str(r.title) ?? "",
    url: str(r.link),
    price: str(r.price),
    delivery: str(r.delivery),
    source: str(r.source),
    rating: num(r.rating),
    reviews: num(r.ratingCount),
    thumbnail: str(r.imageUrl),
  }));
}

export interface ScholarResult {
  position: number; title: string; url?: string; pdfUrl?: string; snippet?: string; publicationInfo?: string; year?: number; citedBy?: number;
}

export async function searchScholar(query: string, limit: number, apiKey?: string): Promise<ScholarResult[]> {
  const papers = await serperResults("scholar", { q: query }, "organic", limit, apiKey);
  return papers.map((r, i) => ({
    position: i + 1,
    title: str(r.title) ?? "",
    url: str(r.link),
    pdfUrl: str(r.pdfUrl),
    snippet: str(r.snippet),
    publicationInfo: str(r.publicationInfo),
    year: num(r.year),
    citedBy: num(r.citedBy),
  }));
}

export async function searchAutocomplete(query: string, limit: number, apiKey?: string): Promise<string[]> {
  const data = await serperQuery("autocomplete", { q: query }, apiKey);
  return asRecords(data.suggestions).slice(0, limit)
    .map((r) => str(r.value))
    .filter((v): v is string => v !== undefined);
}

export interface TrendsPoint { date?: string; timestamp?: string; values: { query: string; value?: number }[] }

export async function searchTrends(query: string, apiKey?: string): Promise<TrendsPoint[]> {
  const data = await serpApiQuery("google_trends", { q: query, data_type: "TIMESERIES" }, apiKey);
  const iot = isRecord(data.interest_over_time) ? data.interest_over_time : undefined;
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
