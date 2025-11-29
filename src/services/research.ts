/**
 * Research Service
 * Orchestrates search + fetch + AI summarization for one-stop research
 *
 * Requirements: 2.1, 2.2, 2.3
 * - Search the web for query
 * - Fetch top results
 * - Generate AI summary
 */

import type { ResearchSource } from "../types";
import { fetchBasicPage } from "../tools/fetch-basic";
import {
  summarize,
  type AIServiceConfig,
  AIUnavailableError,
} from "./ai";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  position: number;
}

export interface ResearchOptions {
  query: string;
  resultCount: number;
  includeRawContent: boolean;
  aiConfig: AIServiceConfig;
}

export interface ResearchResult {
  query: string;
  sources: ResearchSource[];
  summary: string;
  keyFindings: string[];
}

/**
 * Search DuckDuckGo and return results
 */
async function searchWeb(
  query: string,
  limit: number
): Promise<SearchResult[]> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetch(searchUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "text/html",
    },
  });

  if (!response.ok) {
    throw new Error(`Search failed: ${response.status}`);
  }

  const html = await response.text();
  return parseDuckDuckGoResults(html, limit);
}

/**
 * Parse DuckDuckGo HTML results
 */
function parseDuckDuckGoResults(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];
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
        snippet: decodeHtmlEntities(snippet?.trim() || ""),
        position: position++,
      });
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

/**
 * Fetch a single URL for research, handling errors gracefully
 */
async function fetchForResearch(
  searchResult: SearchResult,
  includeRawContent: boolean
): Promise<ResearchSource | null> {
  try {
    const result = await fetchBasicPage(searchResult.url, 10000);
    return {
      url: searchResult.url,
      title: result.title || searchResult.title,
      snippet: searchResult.snippet,
      content: includeRawContent ? result.content : undefined,
      fetchedAt: result.fetchedAt,
    };
  } catch {
    // Return source with just search data if fetch fails
    return {
      url: searchResult.url,
      title: searchResult.title,
      snippet: searchResult.snippet,
      fetchedAt: new Date().toISOString(),
    };
  }
}

/**
 * Perform comprehensive research on a topic
 * Searches, fetches top results, and generates AI summary
 */
export async function research(
  options: ResearchOptions
): Promise<ResearchResult> {
  const { query, resultCount, includeRawContent, aiConfig } = options;

  // Step 1: Search the web
  const searchResults = await searchWeb(query, resultCount);

  if (searchResults.length === 0) {
    return {
      query,
      sources: [],
      summary: "No search results found for this query.",
      keyFindings: [],
    };
  }

  // Step 2: Fetch all results in parallel
  const fetchPromises = searchResults.map((sr) =>
    fetchForResearch(sr, includeRawContent)
  );
  const fetchedResults = await Promise.all(fetchPromises);
  const sources = fetchedResults.filter(
    (s): s is ResearchSource => s !== null
  );

  // Step 3: Combine content for summarization
  const combinedContent = sources
    .map(
      (s) =>
        `## ${s.title}\nURL: ${s.url}\n${s.content || s.snippet || ""}`
    )
    .join("\n\n");

  // Step 4: Generate AI summary
  let summary = "";
  let keyFindings: string[] = [];

  try {
    const aiResult = await summarize(aiConfig, {
      content: combinedContent,
      query,
      maxLength: 400,
    });
    summary = aiResult.summary;
    keyFindings = aiResult.keyFindings;
  } catch (error) {
    if (error instanceof AIUnavailableError) {
      throw error;
    }
    // Fallback summary if AI fails
    summary = `Research found ${sources.length} sources for "${query}". ${sources.map((s) => s.title).join(", ")}.`;
    keyFindings = sources.slice(0, 3).map((s) => s.snippet || s.title);
  }

  return {
    query,
    sources,
    summary,
    keyFindings,
  };
}
