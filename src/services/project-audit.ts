/**
 * Off-chain project due diligence.
 *
 * WHY THIS EXISTS. The x402 buyers who demonstrably hold funded wallets buy
 * crypto risk data, and they pay real prices for it — rug checks at $0.02, a
 * market signal at $0.20, full due diligence at $0.50. Every incumbent on that
 * rail (SolProbe, wick.pics, Rug Munch, Arkham) analyses the CHAIN: contract
 * permissions, liquidity locks, holder distribution, wash trading.
 *
 * Nobody sells the other half. The 2026 rug-pull literature is explicit that
 * detection needs "on-chain AND OSINT signals", and OSINT means the web: how
 * old the domain is, who registered it, whether a team page exists, whether
 * the site is a $9 template, and — the signal no on-chain tool can produce —
 * whether the contract address printed on the project's own website is the
 * one you are about to trade.
 *
 * WebLens already had every primitive for this. The whole endpoint is a
 * composition of existing free-upstream services, so it costs the usual
 * ~$0.000002 to serve while selling into a market that pays 10-50x our
 * other endpoints.
 *
 * WHAT THIS IS NOT: this is not a rug checker. It reads nothing on-chain and
 * makes no claim about a contract's code, liquidity or ownership. It is the
 * off-chain complement to those tools, and the response says so.
 */

import type { Env } from "../types";
import { inspectDomain, normalizeDomain  } from "./domain-intel";
import type {DomainReport} from "./domain-intel";
import { fetchSitePage, findSocials, pageHrefs } from "./site-pages";
import type { SitePage } from "./site-pages";
import { fingerprint  } from "./tech-detect";
import type {Detection} from "./tech-detect";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_HTML_BYTES = 400_000;

/** Site builders that indicate an off-the-shelf page rather than a built product. */
const TEMPLATE_PLATFORMS = new Set(["Wix", "Squarespace", "Webflow", "WordPress", "Ghost"]);

/** Evidence of the pages a legitimate project almost always publishes. */
const PAGE_PATTERNS: [key: string, pattern: RegExp][] = [
    ["team", /\b(our[- ]?team|team|about[- ]?us|founders|leadership)\b/iu],
    ["whitepaper", /\b(white[- ]?paper|lite[- ]?paper)\b/iu],
    ["docs", /\b(docs|documentation|gitbook|developer)\b/iu],
    ["tokenomics", /\b(tokenomics|token[- ]?economics|distribution)\b/iu],
    ["audit", /\b(audit|audited|certik|hacken|slowmist)\b/iu],
    ["roadmap", /\broadmap\b/iu],
];

/** EVM contract addresses. Solana keys are checked by exact match instead —
 *  base58 is too permissive to extract without false positives. */
const EVM_ADDRESS = /\b0x[a-fA-F0-9]{40}\b/gu;

export interface ProjectAudit {
    project: { input: string; domain: string; reachable: boolean; status?: number; title?: string };
    domain: {
        registeredAt?: string;
        ageDays?: number;
        expiresAt?: string;
        registrar?: string;
        nameservers?: string[];
        found: boolean;
    };
    site: {
        technologies: Detection[];
        categories: Partial<Record<string, string[]>>;
        generator?: string;
        looksTemplated: boolean;
    };
    content: {
        pages: Record<string, boolean>;
        socials: Record<string, string>;
        contractAddresses: string[];
    };
    crossCheck?: {
        queried: string;
        chain?: string;
        foundOnSite: boolean;
        otherAddressesOnSite: string[];
    };
    signals: string[];
    risk: { score: number; grade: string; summary: string };
    disclaimer: string;
}

const DISCLAIMER =
    "Off-chain signals only. This reads the project's public web presence and DNS — it does not inspect the contract, liquidity, ownership or holders. Pair it with an on-chain rug checker; neither half is sufficient alone.";

/** Extract every href and the visible text, cheaply, without a DOM. */
function linksAndText(html: string): { hrefs: string[]; text: string } {
    const hrefs = pageHrefs(html);
    const text = html
        .replace(/<script[\s\S]*?<\/script>/giu, " ")
        .replace(/<style[\s\S]*?<\/style>/giu, " ")
        .replace(/<[^>]+>/gu, " ");
    return { hrefs, text };
}

function titleOf(html: string): string | undefined {
    return /<title[^>]*>([^<]{1,200})<\/title>/iu.exec(html)?.[1]?.trim();
}

/**
 * Score is additive risk, not a probability. Each weight reflects how strongly
 * the signal correlates with a project that is not what it claims — a domain
 * registered last week alongside a token launch is the single loudest one.
 */
const WEIGHTS: Record<string, number> = {
    "site-unreachable": 30,
    "very-new-domain": 30,
    "newly-registered-domain": 18,
    "contract-mismatch": 30,
    "contract-not-on-site": 15,
    "no-team-page": 12,
    "no-whitepaper": 8,
    "no-docs": 5,
    "no-socials": 15,
    "no-github": 6,
    "templated-site": 8,
    "registration-unavailable": 5,
    "domain-expires-soon": 8,
    "no-registrar-lock": 4,
};

function gradeFor(score: number): string {
    if (score <= 10) { return "A"; }
    if (score <= 25) { return "B"; }
    if (score <= 45) { return "C"; }
    if (score <= 70) { return "D"; }
    return "F";
}

export async function auditProject(
    input: string,
    env: Env,
    tokenAddress?: string,
    chain?: string,
): Promise<ProjectAudit | null> {
    const domain = normalizeDomain(input);
    if (!domain) { return null; }

    // One fetch of the homepage serves both the tech fingerprint and the
    // content analysis; DNS/RDAP runs concurrently.
    const homepage = `https://${domain}`;
    const [domainReport, page] = await Promise.all([
        inspectDomain(domain, env),
        fetchSitePage(homepage, { timeoutMs: FETCH_TIMEOUT_MS, maxHtmlBytes: MAX_HTML_BYTES }),
    ]);

    return build(input, domain, domainReport, page, tokenAddress, chain);
}

function build(
    input: string,
    domain: string,
    domainReport: DomainReport,
    page: SitePage,
    tokenAddress?: string,
    chain?: string,
): ProjectAudit {
    const { hrefs, text } = linksAndText(page.html);
    const haystack = `${hrefs.join(" ")} ${text}`;

    const pages: Record<string, boolean> = {};
    for (const [key, pattern] of PAGE_PATTERNS) { pages[key] = pattern.test(haystack); }

    const socials = findSocials(hrefs);

    const contractAddresses = [...new Set((page.html.match(EVM_ADDRESS) ?? []).map((a) => a.toLowerCase()))];

    const { technologies, categories, generator } = fingerprint(page.headers, page.html);
    const looksTemplated = technologies.some((t) => TEMPLATE_PLATFORMS.has(t.name));

    // Contract cross-check. An address that does not appear on the project's
    // own site, on a site that publishes OTHER addresses, is the strongest
    // off-chain impersonation signal available.
    let crossCheck: ProjectAudit["crossCheck"];
    if (tokenAddress) {
        const needle = tokenAddress.toLowerCase();
        const foundOnSite = page.html.toLowerCase().includes(needle);
        crossCheck = {
            queried: tokenAddress,
            chain,
            foundOnSite,
            otherAddressesOnSite: contractAddresses.filter((a) => a !== needle),
        };
    }

    const signals: string[] = [];
    if (!page.ok) { signals.push("site-unreachable"); }
    const age = domainReport.ageDays;
    if (age !== undefined && age < 30) { signals.push("very-new-domain"); }
    else if (age !== undefined && age < 90) { signals.push("newly-registered-domain"); }
    if (!domainReport.registration.found) { signals.push("registration-unavailable"); }
    if (domainReport.signals.includes("expiring-soon")) { signals.push("domain-expires-soon"); }
    if (domainReport.signals.includes("no-registrar-lock")) { signals.push("no-registrar-lock"); }

    if (page.ok) {
        if (!pages.team) { signals.push("no-team-page"); }
        if (!pages.whitepaper) { signals.push("no-whitepaper"); }
        if (!pages.docs) { signals.push("no-docs"); }
        if (Object.keys(socials).length === 0) { signals.push("no-socials"); }
        if (!socials.github) { signals.push("no-github"); }
        if (looksTemplated) { signals.push("templated-site"); }
    }

    if (crossCheck && !crossCheck.foundOnSite) {
        signals.push(crossCheck.otherAddressesOnSite.length > 0 ? "contract-mismatch" : "contract-not-on-site");
    }

    const score = Math.min(100, signals.reduce((sum, s) => sum + (WEIGHTS[s] ?? 0), 0));
    const grade = gradeFor(score);

    return {
        project: { input, domain, reachable: page.ok, status: page.status, title: titleOf(page.html) },
        domain: {
            registeredAt: domainReport.registration.registeredAt,
            ageDays: domainReport.ageDays,
            expiresAt: domainReport.registration.expiresAt,
            registrar: domainReport.registration.registrar,
            nameservers: domainReport.registration.nameservers,
            found: domainReport.registration.found,
        },
        site: { technologies, categories, generator, looksTemplated },
        content: { pages, socials, contractAddresses },
        crossCheck,
        signals,
        risk: { score, grade, summary: summarise(grade, signals) },
        disclaimer: DISCLAIMER,
    };
}

function summarise(grade: string, signals: string[]): string {
    if (signals.length === 0) {
        return "No off-chain risk signals. The web presence is consistent with an established project.";
    }
    const loudest = ["contract-mismatch", "very-new-domain", "site-unreachable", "newly-registered-domain", "no-socials"]
        .filter((s) => signals.includes(s));
    const lead = loudest.length > 0 ? loudest.join(", ") : signals.slice(0, 3).join(", ");
    return `Grade ${grade} on ${String(signals.length)} off-chain signal(s); most significant: ${lead}.`;
}
