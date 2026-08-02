/**
 * Domain intelligence: registration facts + DNS posture + what they reveal.
 *
 * WHY THIS EXISTS. Everyone selling this data sells a *subscription*:
 * WhoisXML starts at $30/mo for 2,000 queries, BuiltWith gates its API behind
 * a $495/mo plan, SecurityTrails is enterprise-quoted. An agent that needs to
 * check one domain cannot buy one domain. Meanwhile both upstreams here are
 * free and HTTP-native, and Workers does not bill subrequests — so a lookup
 * costs us ~$0.000002 and can be sold per call with no account at all.
 *
 * WHY RDAP AND NOT WHOIS. ICANN sunset WHOIS in January 2025 and gTLDs have
 * been switching off port 43. That is load-bearing for us: Workers cannot open
 * a raw TCP socket to port 43 at all, so classic WHOIS was never implementable
 * here. RDAP is HTTPS + JSON, which is exactly what a Worker can do.
 *
 * The derived fields are the actual product. Registration dates and DNS
 * records are commodities; "this domain is 11 days old, has no DMARC, and its
 * registrar lock is off" is a decision.
 */

import type { Env } from "../types";
import { safeFetch } from "../utils/safe-fetch";
import { validateURL } from "./validator";

/** IANA's signed map of TLD -> RDAP service. Cached; it changes rarely. */
const RDAP_BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const BOOTSTRAP_CACHE_KEY = "rdap:bootstrap:v1";
const BOOTSTRAP_TTL_SECONDS = 60 * 60 * 24; // 1 day

const DOH_URL = "https://cloudflare-dns.com/dns-query";
const DNS_TIMEOUT_MS = 5000;
const RDAP_TIMEOUT_MS = 8000;

/** Record types worth one round trip each. */
const RECORD_TYPES = ["A", "AAAA", "MX", "NS", "TXT"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

// ============================================
// Fingerprints
// ============================================

/**
 * TXT domain-verification tokens, which SaaS vendors require you to publish to
 * prove ownership — and which therefore advertise, in public DNS, exactly
 * which products an organisation has onboarded. Matched case-insensitively as
 * a prefix. Only tokens whose vendor attribution is unambiguous are listed:
 * a wrong vendor claim is worse than a missing one.
 */
const TXT_VENDORS: [prefix: string, vendor: string][] = [
    ["google-site-verification=", "Google Workspace"],
    ["ms=", "Microsoft 365"],
    ["ms-domain-verification=", "Microsoft 365"],
    ["atlassian-domain-verification=", "Atlassian"],
    ["atlassian-sending-domain-verification=", "Atlassian"],
    ["docusign=", "DocuSign"],
    ["adobe-idp-site-verification=", "Adobe"],
    ["adobe-sign-verification=", "Adobe"],
    ["facebook-domain-verification=", "Meta"],
    ["workplace-domain-verification=", "Meta Workplace"],
    ["stripe-verification=", "Stripe"],
    ["zoom-domain-verification=", "Zoom"],
    ["zoom_verify_", "Zoom"],
    ["slack-domain-verification=", "Slack"],
    ["apple-domain-verification=", "Apple Business"],
    ["dropbox-domain-verification=", "Dropbox"],
    ["box-domain-verification=", "Box"],
    ["okta-verification=", "Okta"],
    ["notion-domain-verification=", "Notion"],
    ["asana-domain-verification=", "Asana"],
    ["canva-site-verification=", "Canva"],
    ["miro-verification=", "Miro"],
    ["loom-site-verification=", "Loom"],
    ["figma-domain-verification=", "Figma"],
    ["calendly-site-verification=", "Calendly"],
    ["airtable-verification=", "Airtable"],
    ["smartsheet-site-validation=", "Smartsheet"],
    ["wrike-verification=", "Wrike"],
    ["zendesk_verification=", "Zendesk"],
    ["intercom-verification=", "Intercom"],
    ["hubspot-developer-verification=", "HubSpot"],
    ["klaviyo-site-verification=", "Klaviyo"],
    ["segment-site-verification=", "Segment"],
    ["mongodb-site-verification=", "MongoDB"],
    ["datadog-site-verification=", "Datadog"],
    ["dynatrace-site-verification=", "Dynatrace"],
    ["onetrust-domain-verification=", "OneTrust"],
    ["knowbe4-site-verification=", "KnowBe4"],
    ["h1-domain-verification=", "HackerOne"],
    ["detectify-verification=", "Detectify"],
    ["twilio-domain-verification=", "Twilio"],
    ["postman-domain-verification=", "Postman"],
    ["shopify-verification-code=", "Shopify"],
    ["pinterest-site-verification=", "Pinterest"],
    ["yandex-verification=", "Yandex"],
    ["openai-domain-verification=", "OpenAI"],
    ["amazonses:", "Amazon SES"],
    ["citrix-verification-code=", "Citrix"],
    ["logmein-verification-code=", "GoTo"],
    ["globalsign-domain-verification=", "GlobalSign"],
];

/** Salesforce publishes an org id rather than a named token. */
const SALESFORCE_ORG = /^00d[a-z0-9]{12,15}=/iu;

/** MX hostname substring -> the mail platform behind it. */
const MX_PROVIDERS: [needle: string, provider: string][] = [
    ["aspmx.l.google.com", "Google Workspace"],
    ["googlemail.com", "Google Workspace"],
    ["protection.outlook.com", "Microsoft 365"],
    ["mail.protection.outlook.com", "Microsoft 365"],
    ["pphosted.com", "Proofpoint"],
    ["ppe-hosted.com", "Proofpoint"],
    ["mimecast.com", "Mimecast"],
    ["messagelabs.com", "Broadcom Email Security"],
    ["barracudanetworks.com", "Barracuda"],
    ["zoho.com", "Zoho Mail"],
    ["zoho.eu", "Zoho Mail"],
    ["yandex.net", "Yandex Mail"],
    ["mail.ru", "Mail.ru"],
    ["qq.com", "Tencent Exmail"],
    ["fastmail.com", "Fastmail"],
    ["messagingengine.com", "Fastmail"],
    ["icloud.com", "iCloud Mail"],
    ["protonmail.ch", "Proton Mail"],
    ["proton.me", "Proton Mail"],
    ["secureserver.net", "GoDaddy Email"],
    ["privateemail.com", "Namecheap Private Email"],
    ["improvmx.com", "ImprovMX"],
    ["migadu.com", "Migadu"],
    ["titan.email", "Titan"],
    ["awsapps.com", "Amazon WorkMail"],
    ["amazonaws.com", "Amazon SES"],
    ["hostinger.com", "Hostinger"],
    ["ionos.com", "IONOS"],
    ["ovh.net", "OVH"],
];

/** Nameserver substring -> the DNS operator. */
const NS_PROVIDERS: [needle: string, provider: string][] = [
    ["awsdns", "AWS Route 53"],
    ["cloudflare.com", "Cloudflare"],
    // Cloudflare's enterprise nameservers, served from a separate domain —
    // shopify.com and other large sites use these, not *.ns.cloudflare.com.
    ["foundationdns.", "Cloudflare Foundation DNS"],
    ["azure-dns", "Azure DNS"],
    ["googledomains.com", "Google Cloud DNS"],
    ["ns.google.com", "Google Cloud DNS"],
    ["nsone.net", "NS1"],
    ["akam.net", "Akamai"],
    ["akamaiedge.net", "Akamai"],
    ["ultradns", "Vercara UltraDNS"],
    ["dynect.net", "Oracle Dyn"],
    ["domaincontrol.com", "GoDaddy"],
    ["registrar-servers.com", "Namecheap"],
    ["name-services.com", "Enom"],
    ["dnsimple.com", "DNSimple"],
    ["digitalocean.com", "DigitalOcean"],
    ["vercel-dns.com", "Vercel"],
    ["netlify.com", "Netlify"],
    ["wpengine.com", "WP Engine"],
    ["squarespacedns.com", "Squarespace"],
    ["shopify.com", "Shopify"],
    ["wixdns.net", "Wix"],
    ["he.net", "Hurricane Electric"],
    ["gandi.net", "Gandi"],
    ["linode.com", "Linode"],
    ["constellix.com", "Constellix"],
    ["easydns.com", "easyDNS"],
    ["hostgator.com", "HostGator"],
    ["bluehost.com", "Bluehost"],
];

function matchProvider(values: string[], table: [string, string][]): string | undefined {
    for (const value of values) {
        const haystack = value.toLowerCase();
        for (const [needle, provider] of table) {
            if (haystack.includes(needle)) { return provider; }
        }
    }
    return undefined;
}

// ============================================
// Input
// ============================================

/**
 * Accepts a bare hostname or a URL and returns the registrable hostname.
 * Rejects anything that is not a plausible public domain — this value is
 * interpolated into upstream lookups, so it is validated, never trusted.
 */
export function normalizeDomain(input: string): string | null {
    let value = input.trim().toLowerCase();
    if (value === "") { return null; }

    if (value.includes("://")) {
        try { value = new URL(value).hostname; } catch { return null; }
    } else {
        // Strip a path/query someone pasted without a scheme.
        value = value.split(/[/?#]/u)[0] ?? "";
    }
    value = value.replace(/\.$/u, "").replace(/^www\./u, "");
    // Reject userinfo, ports, IPs and anything without a dotted TLD.
    if (/[^a-z0-9.-]/u.test(value)) { return null; }
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/u.test(value)) { return null; }
    if (value.length > 253) { return null; }
    return value;
}

// ============================================
// DNS over HTTPS
// ============================================

interface DohAnswer { name: string; type: number; TTL: number; data: string }

async function dnsQuery(name: string, type: string): Promise<string[]> {
    try {
        const response = await fetch(`${DOH_URL}?name=${encodeURIComponent(name)}&type=${type}`, {
            headers: { Accept: "application/dns-json" },
            signal: AbortSignal.timeout(DNS_TIMEOUT_MS),
        });
        if (!response.ok) { return []; }
        const body = await response.json<{ Answer?: DohAnswer[] }>();
        return (body.Answer ?? []).map((a) => a.data.replace(/^"|"$/gu, ""));
    } catch {
        return [];
    }
}

// ============================================
// RDAP
// ============================================

interface BootstrapFile { services: [tlds: string[], urls: string[]][] }

/** Resolve the RDAP base URL for a TLD via IANA's bootstrap file. */
async function rdapBaseFor(tld: string, env: Env): Promise<string | null> {
    let bootstrap: BootstrapFile | null = null;

    try {
        const cached = await env.CACHE?.get(BOOTSTRAP_CACHE_KEY);
        if (cached) { bootstrap = JSON.parse(cached) as BootstrapFile; }
    } catch { /* fall through to a live fetch */ }

    if (!bootstrap) {
        try {
            const response = await fetch(RDAP_BOOTSTRAP_URL, {
                signal: AbortSignal.timeout(RDAP_TIMEOUT_MS),
            });
            if (!response.ok) { return null; }
            bootstrap = await response.json<BootstrapFile>();
            await env.CACHE?.put(BOOTSTRAP_CACHE_KEY, JSON.stringify(bootstrap), {
                expirationTtl: BOOTSTRAP_TTL_SECONDS,
            });
        } catch {
            return null;
        }
    }

    for (const [tlds, urls] of bootstrap.services) {
        if (!tlds.includes(tld)) { continue; }
        // Prefer https: some ccTLD registries still advertise plaintext RDAP,
        // and these lookups carry the domain being investigated.
        const url = urls.find((u) => u.startsWith("https://")) ?? urls[0];
        return url ? url.replace(/\/$/u, "") : null;
    }
    return null;
}

interface RdapEvent { eventAction: string; eventDate: string }
interface RdapEntity { roles?: string[]; vcardArray?: unknown[] }
interface RdapResponse {
    ldhName?: string;
    status?: string[];
    events?: RdapEvent[];
    nameservers?: { ldhName?: string }[];
    entities?: RdapEntity[];
}

/** Pull the display name out of an RDAP entity's jCard. */
function entityName(entity: RdapEntity): string | undefined {
    const vcard = entity.vcardArray?.[1];
    if (!Array.isArray(vcard)) { return undefined; }
    for (const field of vcard) {
        if (Array.isArray(field) && field[0] === "fn" && typeof field[3] === "string") {
            return field[3];
        }
    }
    return undefined;
}

export interface Registration {
    found: boolean;
    registrar?: string;
    registeredAt?: string;
    expiresAt?: string;
    updatedAt?: string;
    status?: string[];
    nameservers?: string[];
    rdapServer?: string;
}

async function rdapLookup(domain: string, env: Env): Promise<Registration> {
    const tld = domain.slice(domain.lastIndexOf(".") + 1);
    const base = await rdapBaseFor(tld, env);
    if (!base) { return { found: false }; }

    const url = `${base}/domain/${encodeURIComponent(domain)}`;
    // The base URL comes from IANA, but it is still a third-party host we are
    // about to fetch — run it through the same SSRF checks as any other URL.
    if (!validateURL(url).valid) { return { found: false }; }

    try {
        const response = await safeFetch(url, {
            headers: { Accept: "application/rdap+json" },
            signal: AbortSignal.timeout(RDAP_TIMEOUT_MS),
        });
        if (!response.ok) { return { found: false, rdapServer: base }; }

        const data = await response.json<RdapResponse>();
        const events = new Map((data.events ?? []).map((e) => [e.eventAction, e.eventDate]));
        const registrar = (data.entities ?? []).find((e) => e.roles?.includes("registrar"));

        return {
            found: true,
            registrar: registrar ? entityName(registrar) : undefined,
            registeredAt: events.get("registration"),
            expiresAt: events.get("expiration"),
            updatedAt: events.get("last changed"),
            status: data.status,
            nameservers: (data.nameservers ?? [])
                .map((n) => n.ldhName?.toLowerCase())
                .filter((n): n is string => typeof n === "string"),
            rdapServer: base,
        };
    } catch {
        return { found: false, rdapServer: base };
    }
}

// ============================================
// Report
// ============================================

export interface DomainReport {
    domain: string;
    registration: Registration;
    dns: Record<string, string[]>;
    email: {
        provider?: string;
        hasSpf: boolean;
        hasDmarc: boolean;
        dmarcPolicy?: string;
    };
    hosting: { dnsProvider?: string };
    stack: string[];
    signals: string[];
    ageDays?: number;
    expiresInDays?: number;
}

function daysBetween(from: Date, to: Date): number {
    return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/** Everything the caller is really paying for: the interpretation. */
export function derive(domain: string, registration: Registration, dns: Record<string, string[]>, dmarc: string[]): DomainReport {
    const now = new Date();
    const txt = dns.TXT ?? [];

    const stack = new Set<string>();
    for (const record of txt) {
        const lower = record.toLowerCase();
        for (const [prefix, vendor] of TXT_VENDORS) {
            if (lower.startsWith(prefix)) { stack.add(vendor); }
        }
        if (SALESFORCE_ORG.test(lower)) { stack.add("Salesforce"); }
    }

    const spf = txt.find((r) => r.toLowerCase().startsWith("v=spf1"));
    const dmarcRecord = dmarc.find((r) => r.toLowerCase().startsWith("v=dmarc1"));
    const dmarcPolicy = /\bp\s*=\s*(none|quarantine|reject)/iu.exec(dmarcRecord ?? "")?.[1]?.toLowerCase();

    const ageDays = registration.registeredAt
        ? daysBetween(new Date(registration.registeredAt), now)
        : undefined;
    const expiresInDays = registration.expiresAt
        ? daysBetween(now, new Date(registration.expiresAt))
        : undefined;

    // Risk and posture flags. Each one is something a caller would otherwise
    // have to compute themselves from three separate lookups.
    const signals: string[] = [];
    if (ageDays !== undefined && ageDays < 90) { signals.push("newly-registered"); }
    if (expiresInDays !== undefined && expiresInDays < 30) { signals.push("expiring-soon"); }
    if (expiresInDays !== undefined && expiresInDays < 0) { signals.push("expired"); }
    if (registration.found && !(registration.status ?? []).some((s) => s.includes("transfer prohibited"))) {
        signals.push("no-registrar-lock");
    }
    if (!spf) { signals.push("no-spf"); }
    if (!dmarcRecord) { signals.push("no-dmarc"); }
    else if (dmarcPolicy === "none") { signals.push("dmarc-monitor-only"); }
    if ((dns.MX ?? []).length === 0) { signals.push("no-mx"); }
    if (!registration.found) { signals.push("registration-unavailable"); }

    return {
        domain,
        registration,
        dns,
        email: {
            provider: matchProvider(dns.MX ?? [], MX_PROVIDERS),
            hasSpf: spf !== undefined,
            hasDmarc: dmarcRecord !== undefined,
            dmarcPolicy,
        },
        hosting: {
            dnsProvider: matchProvider(
                [...(dns.NS ?? []), ...(registration.nameservers ?? [])],
                NS_PROVIDERS,
            ),
        },
        stack: Array.from(stack).sort(),
        signals,
        ageDays,
        expiresInDays,
    };
}

/**
 * One call: registration, DNS and everything derivable from them. Every
 * upstream is free and every lookup runs concurrently, so wall-clock is one
 * round trip rather than seven.
 */
export async function inspectDomain(domain: string, env: Env): Promise<DomainReport> {
    const [registration, dmarc, ...records] = await Promise.all([
        rdapLookup(domain, env),
        dnsQuery(`_dmarc.${domain}`, "TXT"),
        ...RECORD_TYPES.map((type) => dnsQuery(domain, type)),
    ]);

    const dns: Record<string, string[]> = {};
    RECORD_TYPES.forEach((type, i) => {
        const values = records[i] ?? [];
        if (values.length > 0) { dns[type] = values; }
    });

    return derive(domain, registration, dns, dmarc);
}
