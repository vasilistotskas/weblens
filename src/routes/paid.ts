/**
 * Registers every paid endpoint in the registry (src/endpoints) with one
 * middleware stack:
 *
 *   [cache lookup] → validation → credit debit → x402 payment → [cache serve] → handler
 *
 * Invalid bodies are rejected before any money moves, and the credit debit and
 * the x402 challenge share one price resolver. The only difference is the
 * x402 floor (PRICING.x402Minimum): an x402 sale pays the facilitator a settle
 * fee, so it never charges less than that, while a credit debit settles
 * nothing and pays the list price.
 */

import type { Context, Handler, Hono, MiddlewareHandler } from "hono";
import { ENDPOINTS } from "../endpoints";
import type { PaidPath } from "../endpoints";
import { endpointBodySchema, x402Charge } from "../endpoints/define";
import type { EndpointDefinition } from "../endpoints/define";
import { cacheAwarePrice, cacheLookupMiddleware, cacheServeMiddleware } from "../middleware/cache";
import { createCreditMiddleware } from "../middleware/credit-middleware";
import { createLazyPaymentMiddleware } from "../middleware/payment";
import { validateRequest } from "../middleware/validation";
import { answerHandler } from "../tools/answer";
import { companyHandler } from "../tools/company";
import { contentsHandler } from "../tools/contents";
import { crawlHandler } from "../tools/crawl";
import { buyCreditsHandler } from "../tools/credits";
import { deepResearchHandler } from "../tools/deep-research";
import { discussionsHandler } from "../tools/discussions";
import { domainHandler } from "../tools/domain";
import { extractData } from "../tools/extract-data";
import { fetchBasic } from "../tools/fetch-basic";
import { fetchPro } from "../tools/fetch-pro";
import { mapHandler } from "../tools/map";
import { packageHandler } from "../tools/package-intel";
import { pdfHandler } from "../tools/pdf";
import { projectAuditHandler } from "../tools/project-audit";
import { resilientFetchHandler } from "../tools/resilient-fetch";
import { screenshot } from "../tools/screenshot";
import {
    searchAutocompleteHandler,
    searchImagesHandler,
    searchNewsHandler,
    searchPlacesHandler,
    searchScholarHandler,
    searchShoppingHandler,
    searchTrendsHandler,
} from "../tools/search-verticals";
import { searchWebHandler } from "../tools/search-web";
import { techHandler } from "../tools/tech";
import { youtubeTranscriptHandler } from "../tools/youtube-transcript";
import type { AppEnv } from "../types";

/** Exactly one handler per registry path; a missing or extra path does not compile. */
const HANDLERS: Record<PaidPath, Handler<AppEnv>> = {
    "/fetch/basic": fetchBasic,
    "/fetch/pro": fetchPro,
    "/fetch/resilient": resilientFetchHandler,
    "/screenshot": screenshot,
    "/contents": contentsHandler,
    "/map": mapHandler,
    "/crawl": crawlHandler,
    "/pdf": pdfHandler,
    "/extract": extractData,
    "/search": searchWebHandler,
    "/search/news": searchNewsHandler,
    "/search/images": searchImagesHandler,
    "/search/places": searchPlacesHandler,
    "/search/shopping": searchShoppingHandler,
    "/search/scholar": searchScholarHandler,
    "/search/autocomplete": searchAutocompleteHandler,
    "/search/trends": searchTrendsHandler,
    "/social/youtube/transcript": youtubeTranscriptHandler,
    "/answer": answerHandler,
    "/research/deep": deepResearchHandler,
    "/discussions": discussionsHandler,
    "/domain": domainHandler,
    "/package": packageHandler,
    "/tech": techHandler,
    "/company": companyHandler,
    "/intel/project": projectAuditHandler,
    "/credits/buy": buyCreditsHandler,
};

/**
 * The route's price as the money middlewares take it. A price that can never
 * vary is passed as a string, which lets the payment wall cache its
 * middleware; anything else is resolved per request from the validated body.
 */
function routePrice(endpoint: EndpointDefinition): string | ((c: Context<AppEnv>) => Promise<string>) {
    const { price } = endpoint;
    const resolve = (c: Context<AppEnv>) => Promise.resolve(price.resolve(c.get("validatedBody")));
    if (endpoint.cacheKey) {
        return cacheAwarePrice(resolve);
    }
    return price.min === price.max ? price.resolve(undefined) : resolve;
}

/** The same price as the x402 challenge charges it: never below the settle-fee floor. */
function x402RoutePrice(price: ReturnType<typeof routePrice>): ReturnType<typeof routePrice> {
    return typeof price === "string" ? x402Charge(price) : async (c) => x402Charge(await price(c));
}

export function registerPaidRoutes(app: Hono<AppEnv>): void {
    for (const endpoint of ENDPOINTS) {
        const definition: EndpointDefinition = endpoint;
        const price = routePrice(definition);
        const stack: MiddlewareHandler<AppEnv>[] = [];
        if (definition.cacheKey) {
            stack.push(cacheLookupMiddleware(definition.cacheKey));
        }
        stack.push(validateRequest(definition.input));
        if (definition.acceptsCredits) {
            stack.push(createCreditMiddleware(price, definition.title));
        }
        stack.push(createLazyPaymentMiddleware(
            {
                path: definition.path,
                description: definition.description,
                catalogTags: definition.catalogTags,
                evmOnly: definition.evmOnly,
                inputExample: definition.inputExample,
                inputSchema: endpointBodySchema(definition),
                outputExample: definition.outputExample,
                outputSchema: definition.outputSchema,
            },
            x402RoutePrice(price),
        ));
        if (definition.cacheKey) {
            stack.push(cacheServeMiddleware());
        }
        app.use(definition.path, ...stack);
        app.post(definition.path, HANDLERS[endpoint.path]);
    }
}
