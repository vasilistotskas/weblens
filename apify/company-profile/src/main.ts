/**
 * Company profiles from domains: one WebLens /company call per domain, one
 * dataset item and one `company-profile` charge per profile delivered.
 *
 * - The user's budget is checked BEFORE each call, so WebLens is never asked
 *   for a profile this run cannot bill for (docs.apify.com: pay-per-event).
 * - A profile is charged only when it is delivered: a domain whose site cannot
 *   be read costs the user nothing and is listed in the run's OUTPUT record.
 * - Transient failures (HTTP 429 and 5xx other than "site unreachable") are
 *   retried once.
 */

import { Actor, log } from "apify";

/** The WebLens API this Actor resells, and how it authenticates as Apify's partner. */
const WEBLENS = {
    /** WEBLENS_API_URL points a local run at a development server. */
    origin: process.env.WEBLENS_API_URL ?? "https://api.weblens.dev",
    partnerHeader: "X-WebLens-Partner-Key",
    timeoutMs: 90_000,
} as const;

const CHARGE_EVENT = "company-profile";
const CONCURRENCY = 5;

interface Input {
    domains?: unknown;
}

interface Failure {
    domain: string;
    status?: number;
    error: string;
}

/**
 * Statuses worth one retry: rate limiting, a WebLens error, or its AI service briefly down. Not 502 (the
 * site could not be read or had nothing to profile) or a 4xx about the domain, which a retry will not change.
 */
function isTransient(status: number): boolean {
    return status === 429 || status === 500 || status === 503;
}

async function requestProfile(domain: string, partnerKey: string): Promise<{ ok: true; profile: Record<string, unknown> } | { ok: false; failure: Failure; transient: boolean }> {
    try {
        const response = await fetch(new URL("/company", WEBLENS.origin), {
            method: "POST",
            headers: { "Content-Type": "application/json", [WEBLENS.partnerHeader]: partnerKey },
            body: JSON.stringify({ domain }),
            signal: AbortSignal.timeout(WEBLENS.timeoutMs),
        });
        const body: unknown = await response.json().catch(() => undefined);
        const record = typeof body === "object" && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : undefined;
        if (response.ok && record) {
            return { ok: true, profile: record };
        }
        const message = typeof record?.message === "string" ? record.message : `HTTP ${String(response.status)}`;
        return { ok: false, failure: { domain, status: response.status, error: message }, transient: isTransient(response.status) };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, failure: { domain, error: message }, transient: true };
    }
}

/** Distinct, non-empty domains from the input. */
function inputDomains(input: Input | null): string[] {
    const raw = Array.isArray(input?.domains) ? input.domains : [];
    return [...new Set(raw.filter((d): d is string => typeof d === "string").map((d) => d.trim()).filter((d) => d !== ""))];
}

/** Profile every domain within the user's budget; returns the run's status message. */
async function profileAll(domains: readonly string[], partnerKey: string): Promise<string> {
    const charging = Actor.getChargingManager();
    const queue = [...domains];
    const failures: Failure[] = [];
    let inFlight = 0;
    let delivered = 0;
    let stoppedForBudget = false;

    // True while the budget covers one more profile beyond those already being fetched.
    const budgetAllowsAnother = (): boolean => charging.calculateMaxEventChargeCountWithinLimit(CHARGE_EVENT) > inFlight;

    const worker = async (): Promise<void> => {
        for (let domain = queue.shift(); domain !== undefined; domain = queue.shift()) {
            if (!budgetAllowsAnother()) {
                stoppedForBudget = true;
                queue.length = 0;
                return;
            }
            inFlight += 1;
            try {
                let result = await requestProfile(domain, partnerKey);
                if (!result.ok && result.transient) {
                    log.warning(`Retrying ${domain} once: ${result.failure.error}`);
                    result = await requestProfile(domain, partnerKey);
                }
                if (result.ok) {
                    const charge = await Actor.pushData({ input: domain, ...result.profile }, CHARGE_EVENT);
                    delivered += 1;
                    log.info(`Profiled ${domain}`);
                    if (charge.eventChargeLimitReached) {
                        stoppedForBudget = true;
                        queue.length = 0;
                    }
                } else {
                    failures.push(result.failure);
                    log.warning(`Could not profile ${domain}: ${result.failure.error}`);
                }
            } finally {
                inFlight -= 1;
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, domains.length) }, worker));

    await Actor.setValue("OUTPUT", { requested: domains.length, delivered, failures, stoppedForBudget });
    const notRead = failures.length > 0 ? `, ${String(failures.length)} could not be read (not charged; see OUTPUT)` : "";
    const budget = stoppedForBudget ? ", stopped at your maximum charge for this run" : "";
    return `Profiled ${String(delivered)} of ${String(domains.length)} domains${notRead}${budget}.`;
}

await Actor.init();
const partnerKey = process.env.WEBLENS_PARTNER_KEY ?? "";
const domains = inputDomains(await Actor.getInput<Input>());
if (partnerKey === "") {
    await Actor.fail("WEBLENS_PARTNER_KEY is not set on this Actor.");
} else if (domains.length === 0) {
    await Actor.fail("Add at least one domain to the input, e.g. \"gitlab.com\".");
} else {
    await Actor.exit(await profileAll(domains, partnerKey));
}
