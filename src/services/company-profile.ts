/**
 * A company profile from its domain, read live from the company's own site.
 *
 * Incumbents (PredictLeads, TheirStack, Diffbot, BuiltWith, Wappalyzer) sell
 * database snapshots behind accounts. This reads the source instead, in one
 * call: what the company sells and to whom (homepage, about and pricing pages,
 * one AI_MODEL pass that must name the page each answer came from), whether it
 * is hiring (its public job board), its tech stack, socials and security
 * contact, and the registration and email posture of the domain.
 *
 * Company-level facts only: no people, no personal contact details. robots.txt
 * is honoured for every page fetched.
 */

import { BOT_USER_AGENT, COMPANY_PROFILE } from "../config";
import type { Env } from "../types";
import { isRecord, str } from "../utils/narrow";
import { htmlToMarkdown, extractMetadata } from "../utils/parser";
import { readTextCapped, safeFetch } from "../utils/safe-fetch";
import { callClaude } from "./ai";
import { extractLinks, fetchRobots, isAllowedByRobots } from "./crawler";
import type { RobotsRules } from "./crawler";
import { inspectDomain } from "./domain-intel";
import type { DomainReport } from "./domain-intel";
import { fetchHiring, findJobBoard } from "./job-boards";
import type { Hiring } from "./job-boards";
import { fetchSitePage, findSocials, pageHrefs } from "./site-pages";
import type { SitePage } from "./site-pages";
import { fingerprint } from "./tech-detect";

export type PageRole = "about" | "pricing" | "careers" | "contact";

/** The pages that answer the profile's questions, recognised by the path a homepage links to. */
const PAGE_ROLES: readonly (readonly [PageRole, RegExp])[] = [
    ["about", /\/(?:about(?:-us)?|company|who-we-are)\/?$/iu],
    ["pricing", /\/(?:pricing|plans|prices)\/?$/iu],
    ["careers", /\/(?:careers?|jobs|join(?:-us)?|work-with-us)\/?$/iu],
    ["contact", /\/(?:contact(?:-us)?|support)\/?$/iu],
];

export const PRICING_MODELS = ["free", "freemium", "subscription", "usage-based", "one-time", "contact-sales"] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];

export interface PricingPlan {
    name: string;
    /** As written on the page, e.g. "$29", "Custom". */
    price?: string;
    period?: string;
}

/** The fields the AI pass answers, each tied to the page it came from. */
const AI_FIELDS = ["name", "description", "offerings", "audience", "pricing"] as const;
type AiField = (typeof AI_FIELDS)[number];

export interface CompanyProfile {
    domain: string;
    /** The homepage after redirects. */
    url: string;
    name?: string;
    description?: string;
    offerings: string[];
    audience?: string;
    pricing: { pageUrl?: string; model?: PricingModel; plans: PricingPlan[] };
    /** Absent when the site links to no job board WebLens can read. */
    hiring?: Hiring;
    pages: Partial<Record<PageRole, string>>;
    socials: Record<string, string>;
    tech: { technologies: { name: string; category: string }[]; categories: Partial<Record<string, string[]>> };
    domainFacts: {
        registrar?: string;
        registeredAt?: string;
        ageDays?: number;
        emailProvider?: string;
        hasSpf: boolean;
        hasDmarc: boolean;
        dmarcPolicy?: string;
        dnsProvider?: string;
        /** SaaS vendors revealed by the domain's TXT verification records. */
        saas: string[];
        signals: string[];
    };
    /** Company-level contact channels from the site's security.txt (RFC 9116): role mailboxes and company pages. */
    securityContacts: string[];
    /** The page each AI-read field came from. */
    sources: { field: AiField; url: string }[];
    /** Pages not read, and why. */
    skipped: { url: string; reason: "robots.txt" | "unreachable" }[];
}

/** The homepage could not be read, so there is nothing to profile. */
export class SiteUnreachableError extends Error {}
/** robots.txt disallows the homepage. */
export class RobotsDisallowedError extends Error {}
/** The model did not return the JSON object it was asked for. */
export class ProfileExtractionError extends Error {}

/** The first page per role among the homepage's own links, shortest path first. */
export function classifyPages(links: readonly string[]): Partial<Record<PageRole, string>> {
    const byLength = [...links].sort((a, b) => new URL(a).pathname.length - new URL(b).pathname.length);
    const pages: Partial<Record<PageRole, string>> = {};
    for (const [role, pattern] of PAGE_ROLES) {
        const match = byLength.find((link) => pattern.test(new URL(link).pathname));
        if (match) { pages[role] = match; }
    }
    return pages;
}

/**
 * Words a role mailbox is made of: the RFC 2142 mailbox names (which RFC 9116
 * section 2.5.3 points security.txt at) plus the security-team names real
 * security.txt files use (secalert@redhat.com, psirt@adobe.com,
 * productcert@siemens.com, responsible.disclosure@vercel.com).
 */
const ROLE_MAILBOX_WORDS: ReadonlySet<string> = new Set([
    "info", "marketing", "sales", "support", "abuse", "noc", "security", "postmaster", "hostmaster", "usenet",
    "news", "webmaster", "www", "uucp", "ftp",
    "secalert", "secure", "infosec", "cybersecurity", "psirt", "sirt", "csirt", "cert", "productcert", "soc",
    "product", "disclosure", "responsible", "vulnerability", "vulnerabilities", "vuln", "vulns", "bugbounty",
    "bug", "bugs", "bounty", "report", "reports", "reporting", "alert", "alerts", "notifications", "incident",
    "incidents", "response", "team", "trust", "privacy", "contact", "help",
]);

/** The domain's labels without its TLD: the names a company contact may carry (hp-security-alert@hp.com). */
function companyLabels(domain: string): string[] {
    return domain.split(".").slice(0, -1);
}

/** A mailbox kept only when every word of it is a role word or the company's own name: never a person's. */
function isRoleMailbox(address: string, labels: readonly string[]): boolean {
    const at = address.lastIndexOf("@");
    if (at <= 0) { return false; }
    let local: string;
    try { local = decodeURIComponent(address.slice(0, at)).toLowerCase(); } catch { return false; }
    return local.split(/[.+_-]/u).every((word) => ROLE_MAILBOX_WORDS.has(word) || labels.includes(word));
}

/**
 * A web contact kept only when it is on the company's own site, or names the company in its path
 * (hackerone.com/stripe). A bug-bounty handle can be a person's (securitytxt.org lists hackerone.com/ed).
 */
function isCompanyPage(url: URL, domain: string, labels: readonly string[]): boolean {
    if (url.hostname === domain || url.hostname.endsWith(`.${domain}`)) { return true; }
    const segments = url.pathname.toLowerCase().split("/").filter(Boolean);
    return segments.some((segment) => labels.some((label) => label.length >= 3 ? segment.includes(label) : segment === label));
}

/**
 * Contact lines of a security.txt file (RFC 9116 section 2.5.3), at most five, reduced to company-level
 * channels: role mailboxes and the company's own https pages. Phone numbers and anything that could name a
 * person are dropped, so a personal address published in security.txt never reaches the buyer.
 */
export function securityContacts(text: string, domain: string): string[] {
    const labels = companyLabels(domain);
    const contacts: string[] = [];
    for (const line of text.split(/\r?\n/u)) {
        const value = /^\s*contact\s*:\s*(\S+)/iu.exec(line)?.[1];
        if (value === undefined) { continue; }
        // RFC 9116 requires mailto:, but real files also list a bare address (security@npmjs.com).
        const address = /^mailto:/iu.test(value) ? value.slice("mailto:".length) : value;
        if (!address.includes(":") && address.includes("@")) {
            if (isRoleMailbox(address, labels)) { contacts.push(`mailto:${address}`); }
            continue;
        }
        let url: URL;
        try { url = new URL(value); } catch { continue; }
        if (url.protocol === "https:" && isCompanyPage(url, domain, labels)) { contacts.push(url.href); }
    }
    return contacts.slice(0, 5);
}

async function fetchSecurityContacts(origin: string, domain: string): Promise<string[]> {
    try {
        const response = await safeFetch(`${origin}/.well-known/security.txt`, {
            headers: { "User-Agent": BOT_USER_AGENT, Accept: "text/plain" },
            signal: AbortSignal.timeout(COMPANY_PROFILE.timeoutMs),
        });
        const isText = (response.headers.get("content-type") ?? "").includes("text/plain");
        return response.ok && isText ? securityContacts(await readTextCapped(response, 64 * 1024), domain) : [];
    } catch {
        return [];
    }
}

/** What the AI pass returned, validated: every value typed, every source a page it was given. */
export interface AiProfile {
    name?: string;
    description?: string;
    offerings: string[];
    audience?: string;
    pricingModel?: PricingModel;
    plans: PricingPlan[];
    sources: { field: AiField; url: string }[];
}

function isPricingModel(value: unknown): value is PricingModel {
    return typeof value === "string" && (PRICING_MODELS as readonly string[]).includes(value);
}

function isAiField(value: string): value is AiField {
    return (AI_FIELDS as readonly string[]).includes(value);
}

function normalisedHref(url: string): string | undefined {
    try {
        return new URL(url).href;
    } catch {
        return undefined;
    }
}

/** Parse and validate the model's JSON. Anything off-schema is dropped, not trusted. */
export function parseAiProfile(text: string, pageUrls: readonly string[]): AiProfile {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        throw new ProfileExtractionError("The model did not return JSON");
    }
    if (!isRecord(data)) { throw new ProfileExtractionError("The model did not return a JSON object"); }

    const strings = (value: unknown): string[] =>
        Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "").slice(0, 8) : [];
    const plans: PricingPlan[] = (Array.isArray(data.plans) ? data.plans : [])
        .filter(isRecord)
        .flatMap((plan) => {
            const name = str(plan.name);
            return name ? [{ name, price: str(plan.price), period: str(plan.period) }] : [];
        })
        .slice(0, 8);
    // A source must be a page the model was given. URLs are compared in
    // normalised form (the model may add or drop a trailing slash), and the
    // page's own URL is reported.
    const pageByHref = new Map(pageUrls.flatMap((url) => {
        const href = normalisedHref(url);
        return href ? [[href, url] as const] : [];
    }));
    const sources = isRecord(data.sources)
        ? Object.entries(data.sources).flatMap(([field, url]) => {
            const page = typeof url === "string" ? pageByHref.get(normalisedHref(url) ?? "") : undefined;
            return isAiField(field) && page ? [{ field, url: page }] : [];
        })
        : [];

    return {
        name: str(data.name),
        description: str(data.description),
        offerings: strings(data.offerings),
        audience: str(data.audience),
        pricingModel: isPricingModel(data.pricingModel) ? data.pricingModel : undefined,
        plans,
        sources,
    };
}

const SYSTEM_PROMPT = `You profile a company from its own website. Use ONLY the pages given. When the pages do not state something, use null (or [] for lists). Never guess or use outside knowledge.`;

function aiPrompt(pages: readonly SitePage[]): string {
    const blocks = pages.map((page) => {
        const meta = extractMetadata(page.html);
        const text = htmlToMarkdown(page.html).slice(0, COMPANY_PROFILE.charsPerPage);
        return `<page url="${page.finalUrl}">\nTitle: ${meta.title ?? ""}\nDescription: ${meta.description ?? ""}\n\n${text}\n</page>`;
    });
    return `${blocks.join("\n\n")}

Return this JSON object:
{
  "name": the company's name as the site states it, or null,
  "description": one or two sentences on what the company does, or null,
  "offerings": up to 8 short names of the products or services it sells,
  "audience": one sentence on who it sells to (customer types, industries, company sizes), or null,
  "pricingModel": one of ${PRICING_MODELS.map((m) => `"${m}"`).join(", ")}, or null,
  "plans": up to 8 plans from a pricing page as [{"name", "price" as written or null, "period" or null}], else [],
  "sources": for each of name, description, offerings, audience, pricing that you answered, the url of the page it came from
}

Respond ONLY with valid JSON.`;
}

function domainFacts(report: DomainReport): CompanyProfile["domainFacts"] {
    return {
        registrar: report.registration.registrar,
        registeredAt: report.registration.registeredAt,
        ageDays: report.ageDays,
        emailProvider: report.email.provider,
        hasSpf: report.email.hasSpf,
        hasDmarc: report.email.hasDmarc,
        dmarcPolicy: report.email.dmarcPolicy,
        dnsProvider: report.hosting.dnsProvider,
        saas: report.stack,
        signals: report.signals,
    };
}

/** Profile the company behind `domain` (already normalised by normalizeDomain). */
export async function profileCompany(domain: string, env: Env, anthropicKey: string): Promise<CompanyProfile> {
    const origin = `https://${domain}`;
    const limits: { timeoutMs: number; maxHtmlBytes: number } = { timeoutMs: COMPANY_PROFILE.timeoutMs, maxHtmlBytes: COMPANY_PROFILE.maxHtmlBytes };
    // DNS/RDAP and security.txt do not depend on the pages: start them now.
    const domainReport = inspectDomain(domain, env);
    const contacts = fetchSecurityContacts(origin, domain);

    // robots.txt per origin: a redirect to www. is a different origin with its own rules.
    const robotsByOrigin = new Map<string, Promise<RobotsRules>>();
    const allowed = async (url: string): Promise<boolean> => {
        const pageOrigin = new URL(url).origin;
        let rules = robotsByOrigin.get(pageOrigin);
        if (!rules) {
            rules = fetchRobots(pageOrigin, COMPANY_PROFILE.timeoutMs);
            robotsByOrigin.set(pageOrigin, rules);
        }
        return isAllowedByRobots(url, await rules);
    };

    if (!(await allowed(origin))) {
        throw new RobotsDisallowedError(`robots.txt on ${domain} disallows fetching its homepage`);
    }
    const homepage = await fetchSitePage(origin, limits);
    if (!homepage.ok || homepage.html === "") {
        throw new SiteUnreachableError(`Could not read ${origin} (${homepage.status === undefined ? "no response" : `HTTP ${String(homepage.status)}`})`);
    }

    const links = extractLinks(homepage.html, homepage.finalUrl);
    const pages = classifyPages(links);
    const skipped: CompanyProfile["skipped"] = [];
    const fetchPage = async (url: string, pageLimits: typeof limits): Promise<SitePage | undefined> => {
        if (!(await allowed(url))) { skipped.push({ url, reason: "robots.txt" }); return undefined; }
        const page = await fetchSitePage(url, pageLimits);
        if (!page.ok || page.html === "") { skipped.push({ url, reason: "unreachable" }); return undefined; }
        return page;
    };
    const fetchRole = (role: PageRole): Promise<SitePage | undefined> => {
        const url = pages[role];
        return url ? fetchPage(url, limits) : Promise.resolve(undefined);
    };
    // The careers page is read only to find the job board it links to, which
    // sites often embed deep in the page; when the homepage links none, the
    // conventional path is tried once (a 404 there is not reported).
    const fetchCareers = async (): Promise<SitePage | undefined> => {
        const careersLimits = { ...limits, maxHtmlBytes: COMPANY_PROFILE.maxCareersHtmlBytes };
        if (pages.careers) { return fetchPage(pages.careers, careersLimits); }
        const conventional = new URL(COMPANY_PROFILE.careersPath, homepage.finalUrl).toString();
        if (!(await allowed(conventional))) { return undefined; }
        const page = await fetchSitePage(conventional, careersLimits);
        if (!page.ok || page.html === "") { return undefined; }
        pages.careers = page.finalUrl;
        return page;
    };
    const [about, pricing, careers] = await Promise.all([fetchRole("about"), fetchRole("pricing"), fetchCareers()]);

    const aiPages = [homepage, about, pricing].filter((page): page is SitePage => page !== undefined).slice(0, COMPANY_PROFILE.pagesForAI);
    const board = findJobBoard(careers?.html ?? "") ?? findJobBoard(homepage.html);
    const [aiText, hiring] = await Promise.all([
        callClaude({ apiKey: anthropicKey, maxTokens: COMPANY_PROFILE.maxTokens }, aiPrompt(aiPages), SYSTEM_PROMPT),
        board ? fetchHiring(board, COMPANY_PROFILE) : Promise.resolve(undefined),
    ]);
    const ai = parseAiProfile(aiText, aiPages.map((page) => page.finalUrl));

    const { technologies, categories } = fingerprint(homepage.headers, homepage.html);
    return {
        domain,
        url: homepage.finalUrl,
        name: ai.name,
        description: ai.description,
        offerings: ai.offerings,
        audience: ai.audience,
        pricing: { pageUrl: pricing?.finalUrl, model: ai.pricingModel, plans: ai.plans },
        hiring,
        pages,
        socials: findSocials(pageHrefs(homepage.html)),
        tech: { technologies: technologies.map(({ name, category }) => ({ name, category })), categories },
        domainFacts: domainFacts(await domainReport),
        securityContacts: await contacts,
        sources: ai.sources,
        skipped,
    };
}
