/**
 * Routing policies: 405 for a wrong method, 400 for an unsubstituted path
 * template.
 *
 * Both exist because production logs showed agents bouncing off endpoints that
 * already work. Over one week, ~7k requests POSTed to GET-only routes (`/`,
 * `/discovery`, `/dashboard`, `/mcp/info`, `/credits/history`) and got a bare
 * 404, and ~10.8k asked for a documented path with the placeholder still in it
 * (`/r/{url}`, `/receipts/{requestId}`, …). A 404 tells a caller the resource
 * does not exist, which in both cases is false and unactionable.
 */

import type { Context, Hono, MiddlewareHandler, Next } from "hono";
import { methodNotAllowed } from "hono/method-not-allowed";
import { PAID_ENDPOINTS, PARAMETERIZED_ROUTES } from "../config";
import type { Env, Variables } from "../types";

interface AppEnv { Bindings: Env; Variables: Variables }
type AppContext = Context<AppEnv>;

/**
 * The 405 envelope, shared by both method policies so a caller sees one shape
 * whichever guard answered.
 */
function methodNotAllowedResponse(c: AppContext, allowedMethods: string[]) {
    return c.json(
        {
            error: "METHOD_NOT_ALLOWED",
            code: "METHOD_NOT_ALLOWED",
            message: `${c.req.method} is not supported on ${c.req.path}. Allowed: ${allowedMethods.join(", ")}.`,
            method: c.req.method,
            path: c.req.path,
            allowedMethods,
            requestId: c.get("requestId"),
        },
        405,
        { Allow: allowedMethods.join(", ") },
    );
}

/**
 * Paid endpoints accept POST only.
 *
 * This cannot be folded into `routeMethodGuard`: the payment middlewares are
 * registered with `app.use(path, …)`, which matches every method, so a GET to a
 * paid path is answered with a 402 challenge and never reaches the 404 that the
 * built-in guard keys on. This must run first and short-circuit.
 */
export async function paidEndpointsArePostOnly(c: AppContext, next: Next) {
    if (c.req.method !== "POST" && PAID_ENDPOINTS.includes(c.req.path)) {
        return methodNotAllowedResponse(c, ["POST"]);
    }
    await next();
}

/**
 * 405 + `Allow` for any other path registered under a different method.
 *
 * Hono answers 404 for those by default; the built-in middleware derives the
 * allowed set from the app's own route table, so it cannot drift as routes are
 * added. It only rewrites responses that are already a 404 and carry no error.
 */
export function routeMethodGuard(app: Hono<AppEnv>): MiddlewareHandler<AppEnv> {
    return methodNotAllowed<AppEnv>({
        app,
        onMethodNotAllowed: (c, methods) => methodNotAllowedResponse(c, methods),
    });
}

/** Published template → its metadata. Built once; the table is static. */
const ROUTE_BY_TEMPLATE = new Map(PARAMETERIZED_ROUTES.map((route) => [route.template, route]));

/**
 * Answers a request whose path is still a documented template.
 *
 * The match is an exact comparison against the published template, which is
 * precise in both directions: `%7Burl%7D` arrives decoded as `/r/{url}` and
 * matches, while a real target like `/r/https://example.com/a{b}` does not.
 *
 * Runs ahead of the rate limiter so a malformed call costs the caller no quota.
 */
export async function pathTemplateMiddleware(c: AppContext, next: Next) {
    const route = ROUTE_BY_TEMPLATE.get(c.req.path);
    if (!route) {
        await next();
        return;
    }

    c.get("log").info("route.template.unsubstituted", { template: route.template });

    return c.json(
        {
            error: "UNSUBSTITUTED_PATH_TEMPLATE",
            code: "UNSUBSTITUTED_PATH_TEMPLATE",
            message: `The path still contains the placeholder {${route.param}}. ${route.hint}`,
            template: route.template,
            parameter: route.param,
            allowedMethods: route.methods,
            example: `${new URL(c.req.url).origin}${route.example}`,
            requestId: c.get("requestId"),
        },
        400,
    );
}
