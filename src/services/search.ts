/**
 * Search Service (SerpAPI).
 *
 * Every search runs on SerpAPI. There is deliberately no scraping fallback:
 * a paying caller must never silently receive degraded results. A missing key
 * raises SearchProviderUnavailableError (503) and a provider failure raises
 * SearchUpstreamError (502), so the paid request fails, its settlement is
 * cancelled and any credit debit is refunded.
 *
 * Response field names below were validated against live SerpAPI responses
 * for every engine (organic_results, news_results, images_results,
 * local_results, shopping_results, suggestions, interest_over_time,
 * transcript).
 */

import { PAID_UPSTREAMS } from "../config";
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
  serpApiKey?: string;
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
    // Provider error bodies can echo the request URL, key included.
    super(`Search provider error: ${detail.replace(/api_key=[^&\s"]+/gu, "api_key=REDACTED")}`);
    this.name = "SearchUpstreamError";
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
    `${PAID_UPSTREAMS.serpApiSearch}?${qs.toString()}&api_key=${encodeURIComponent(apiKey)}`,
    { signal: AbortSignal.timeout(15000) },
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
  // Treating the former as a failure answered a query with no matches as a
  // 502 "provider temporarily unavailable".
  const status = isRecord(data.search_metadata) ? str(data.search_metadata.status) : undefined;
  const error = str(data.error);
  if (error && status !== "Success") {
    throw new SearchUpstreamError(undefined, error);
  }
  return data;
}

/** Web search: Google organic results via SerpAPI. */
export async function searchWeb({ query, limit, serpApiKey }: SearchOptions): Promise<SearchResult[]> {
  const data = await serpApiQuery("google", { q: query, num: String(limit) }, serpApiKey);
  return asRecords(data.organic_results).slice(0, limit).map((r, i) => ({
    title: str(r.title) ?? "",
    url: str(r.link) ?? "",
    snippet: str(r.snippet) ?? "",
    position: i + 1,
  }));
}


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
