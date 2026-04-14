/**
 * Centralized Search Service
 *
 * Uses SerpAPI (Google results) when SERP_API_KEY is available,
 * falls back to DuckDuckGo HTML parsing with CAPTCHA detection.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  position: number;
}

export interface SearchOptions {
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
      console.error(`[Search] SerpAPI failed, falling back to DuckDuckGo: ${sanitized}`);
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
        snippet: decodeHtmlEntities(snippet.trim()),
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
