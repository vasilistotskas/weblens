/**
 * SERP Vertical Endpoint Handlers
 * POST /search/news | /search/images | /search/places | /search/shopping
 *      /search/scholar | /search/autocomplete | /search/trends
 *
 * Each vertical is exactly one provider call: Serper (SERPER_API_KEY) for the
 * Google verticals, SerpAPI (SERP_API_KEY) for Trends. No scraping fallback —
 * a missing key surfaces as SERVICE_UNAVAILABLE rather than degraded results.
 */

import type { Context } from "hono";
import type { z } from "zod/v4";
import { classifySearchError, createErrorResponse } from "../middleware/errorHandler";
import type {
    VerticalSearchRequestSchema,
    PlacesSearchRequestSchema,
    TrendsRequestSchema,
} from "../schemas";
import {
    searchNews,
    searchImages,
    searchPlaces,
    searchShopping,
    searchScholar,
    searchAutocomplete,
    searchTrends,
} from "../services/search";
import type { AppEnv } from "../types";

type AppContext = Context<AppEnv>;

function verticalError(c: AppContext, requestId: string, error: unknown) {
    const { code, status, message } = classifySearchError(error, c.get("log"));
    return c.json(createErrorResponse(code, message, requestId), status);
}

/** Build a handler for verticals that take {query, limit}. */
function makeVerticalHandler<T>(
    search: (query: string, limit: number, apiKey?: string) => Promise<T[]>,
    resultsKey: string,
) {
    return async (c: AppContext) => {
        const requestId = c.get("requestId");
        try {
            const { query, limit } = c.get("validatedBody") as z.infer<typeof VerticalSearchRequestSchema>;
            const results = await search(query, limit, c.env.SERPER_API_KEY);
            return c.json({
                query,
                [resultsKey]: results,
                searchedAt: new Date().toISOString(),
                requestId,
            });
        } catch (error) {
            return verticalError(c, requestId, error);
        }
    };
}

export const searchNewsHandler = makeVerticalHandler(searchNews, "results");
export const searchImagesHandler = makeVerticalHandler(searchImages, "results");
export const searchShoppingHandler = makeVerticalHandler(searchShopping, "results");
export const searchScholarHandler = makeVerticalHandler(searchScholar, "results");
export const searchAutocompleteHandler = makeVerticalHandler(searchAutocomplete, "suggestions");

export async function searchPlacesHandler(c: AppContext) {
    const requestId = c.get("requestId");
    try {
        const { query, location, limit } = c.get("validatedBody") as z.infer<typeof PlacesSearchRequestSchema>;
        const results = await searchPlaces(query, limit, c.env.SERPER_API_KEY, location);
        return c.json({
            query,
            location,
            results,
            searchedAt: new Date().toISOString(),
            requestId,
        });
    } catch (error) {
        return verticalError(c, requestId, error);
    }
}

export async function searchTrendsHandler(c: AppContext) {
    const requestId = c.get("requestId");
    try {
        const { query } = c.get("validatedBody") as z.infer<typeof TrendsRequestSchema>;
        const timeline = await searchTrends(query, c.env.SERP_API_KEY);
        return c.json({
            query,
            timeline,
            searchedAt: new Date().toISOString(),
            requestId,
        });
    } catch (error) {
        return verticalError(c, requestId, error);
    }
}
