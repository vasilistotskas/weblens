/**
 * Research Service
 * Orchestrates search + fetch + AI summarization for one-stop research
 *
 * Requirements: 2.1, 2.2, 2.3
 * - Search the web for query
 * - Fetch top results
 * - Generate AI summary
 */

import { fetchBasicPage } from "../tools/fetch-basic";
import type { ResearchSource } from "../types";
import {
  summarize,

  AIUnavailableError
} from "./ai";
import type {AIServiceConfig} from "./ai";
import type { SearchResult } from "./search";
import { searchWeb } from "./search";

export type { SearchResult };

export interface ResearchOptions {
  query: string;
  resultCount: number;
  includeRawContent: boolean;
  aiConfig: AIServiceConfig;
  serpApiKey?: string;
}

export interface ResearchResult {
  query: string;
  sources: ResearchSource[];
  summary: string;
  keyFindings: string[];
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
  const { query, resultCount, includeRawContent, aiConfig, serpApiKey } = options;

  // Step 1: Search the web
  const searchResults = await searchWeb({ query, limit: resultCount, serpApiKey });

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
        `## ${s.title}\nURL: ${s.url}\n${s.content ?? s.snippet}`
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
    summary = `Research found ${String(sources.length)} sources for "${query}". ${sources.map((s) => s.title).join(", ")}.`;
    keyFindings = sources.slice(0, 3).map((s) => s.snippet);
  }

  return {
    query,
    sources,
    summary,
    keyFindings,
  };
}
