/**
 * Website technology detection from one fetch.
 *
 * The other half of what BuiltWith sells at $295/mo. `/domain` reads an
 * organisation's SaaS stack out of DNS; this reads the site's own stack out of
 * what the server sends back — response headers and the HTML it serves.
 *
 * Cost is a single native fetch, so this is another sub-cent endpoint that a
 * subscription vendor cannot match on price.
 *
 * Evidence is reported alongside every detection. A fingerprint table is a
 * pile of heuristics, and a caller who can see *why* something matched can
 * judge it; one who is handed a bare vendor list cannot.
 */

import { safeFetch } from "../utils/safe-fetch";

/** Enough HTML to cover head + early body markers without buffering a novel. */
const MAX_HTML_BYTES = 300_000;
const FETCH_TIMEOUT_MS = 12_000;
const UA = "Mozilla/5.0 (compatible; WebLensBot/1.0; +https://api.weblens.dev)";

export type Category =
    | "framework" | "cms" | "ecommerce" | "cdn" | "analytics"
    | "hosting" | "security" | "support" | "payments" | "server";

export interface Detection {
    name: string;
    category: Category;
    /** What matched — a header line or an HTML marker. */
    evidence: string;
}

interface Rule { name: string; category: Category; needle: string }

/**
 * Header rules. `needle` is matched case-insensitively against "name: value",
 * so a rule can key on the header name alone (its presence is the signal) or
 * on a specific value.
 */
const HEADER_RULES: Rule[] = [
    { name: "Vercel", category: "hosting", needle: "x-vercel-id" },
    { name: "Vercel", category: "hosting", needle: "server: vercel" },
    { name: "Netlify", category: "hosting", needle: "x-nf-request-id" },
    { name: "GitHub Pages", category: "hosting", needle: "x-github-request-id" },
    { name: "Fly.io", category: "hosting", needle: "fly-request-id" },
    { name: "Render", category: "hosting", needle: "x-render-origin-server" },
    { name: "Google Cloud", category: "hosting", needle: "x-cloud-trace-context" },
    { name: "AWS ELB", category: "hosting", needle: "server: awselb" },
    { name: "Cloudflare", category: "cdn", needle: "cf-ray" },
    { name: "Amazon CloudFront", category: "cdn", needle: "x-amz-cf-id" },
    { name: "Fastly", category: "cdn", needle: "x-fastly-request-id" },
    { name: "Akamai", category: "cdn", needle: "server: akamaighost" },
    { name: "Varnish", category: "cdn", needle: "x-varnish" },
    { name: "Next.js", category: "framework", needle: "x-powered-by: next.js" },
    { name: "Nuxt", category: "framework", needle: "x-powered-by: nuxt" },
    { name: "Express", category: "framework", needle: "x-powered-by: express" },
    { name: "PHP", category: "framework", needle: "x-powered-by: php" },
    { name: "ASP.NET", category: "framework", needle: "x-powered-by: asp.net" },
    { name: "Ruby on Rails", category: "framework", needle: "x-runtime" },
    { name: "Shopify", category: "ecommerce", needle: "x-shopify-stage" },
    { name: "Shopify", category: "ecommerce", needle: "x-shopid" },
    { name: "WooCommerce", category: "ecommerce", needle: "x-wc-" },
    { name: "Drupal", category: "cms", needle: "x-drupal-cache" },
    { name: "Drupal", category: "cms", needle: "x-generator: drupal" },
    { name: "Wix", category: "cms", needle: "x-wix-request-id" },
    { name: "Squarespace", category: "cms", needle: "x-contextid" },
    { name: "WordPress", category: "cms", needle: "x-powered-by: wp" },
    { name: "nginx", category: "server", needle: "server: nginx" },
    { name: "Apache", category: "server", needle: "server: apache" },
    { name: "Caddy", category: "server", needle: "server: caddy" },
    { name: "LiteSpeed", category: "server", needle: "server: litespeed" },
    { name: "OpenResty", category: "server", needle: "server: openresty" },
    { name: "Google Web Server", category: "server", needle: "server: gws" },
    { name: "HSTS", category: "security", needle: "strict-transport-security" },
    { name: "Content Security Policy", category: "security", needle: "content-security-policy" },
];

/** HTML rules, matched case-insensitively against the fetched markup. */
const HTML_RULES: Rule[] = [
    { name: "Next.js", category: "framework", needle: "/_next/static" },
    { name: "Next.js", category: "framework", needle: "__next_data__" },
    { name: "Nuxt", category: "framework", needle: "/_nuxt/" },
    { name: "Gatsby", category: "framework", needle: "/page-data/" },
    { name: "Astro", category: "framework", needle: "content=\"astro" },
    { name: "Angular", category: "framework", needle: "ng-version=" },
    { name: "Svelte", category: "framework", needle: "__sveltekit" },
    { name: "React", category: "framework", needle: "data-reactroot" },
    { name: "Vue.js", category: "framework", needle: "data-v-app" },
    { name: "Docusaurus", category: "framework", needle: "content=\"docusaurus" },
    { name: "WordPress", category: "cms", needle: "/wp-content/" },
    { name: "WordPress", category: "cms", needle: "/wp-includes/" },
    { name: "Ghost", category: "cms", needle: "content=\"ghost" },
    { name: "Hugo", category: "cms", needle: "content=\"hugo" },
    { name: "Jekyll", category: "cms", needle: "content=\"jekyll" },
    { name: "Webflow", category: "cms", needle: "content=\"webflow" },
    { name: "Squarespace", category: "cms", needle: "squarespace.com" },
    { name: "Wix", category: "cms", needle: "static.parastorage.com" },
    { name: "Shopify", category: "ecommerce", needle: "cdn.shopify.com" },
    { name: "Shopify", category: "ecommerce", needle: "window.shopify" },
    { name: "WooCommerce", category: "ecommerce", needle: "woocommerce" },
    { name: "Magento", category: "ecommerce", needle: "/static/version" },
    { name: "BigCommerce", category: "ecommerce", needle: "bigcommerce.com" },
    { name: "Google Tag Manager", category: "analytics", needle: "googletagmanager.com" },
    { name: "Google Analytics", category: "analytics", needle: "google-analytics.com" },
    { name: "Meta Pixel", category: "analytics", needle: "connect.facebook.net" },
    { name: "Segment", category: "analytics", needle: "cdn.segment.com" },
    { name: "Mixpanel", category: "analytics", needle: "mixpanel" },
    { name: "Hotjar", category: "analytics", needle: "static.hotjar.com" },
    { name: "PostHog", category: "analytics", needle: "posthog" },
    { name: "Plausible", category: "analytics", needle: "plausible.io" },
    { name: "Fathom", category: "analytics", needle: "usefathom.com" },
    { name: "Cloudflare Web Analytics", category: "analytics", needle: "cloudflareinsights.com" },
    { name: "Amplitude", category: "analytics", needle: "amplitude.com" },
    { name: "New Relic", category: "analytics", needle: "newrelic" },
    { name: "Sentry", category: "analytics", needle: "sentry-cdn.com" },
    { name: "Stripe", category: "payments", needle: "js.stripe.com" },
    { name: "PayPal", category: "payments", needle: "paypal.com/sdk" },
    { name: "Intercom", category: "support", needle: "intercomcdn.com" },
    { name: "Zendesk", category: "support", needle: "zdassets.com" },
    { name: "Drift", category: "support", needle: "js.driftt.com" },
    { name: "Crisp", category: "support", needle: "client.crisp.chat" },
    { name: "HubSpot", category: "support", needle: "js.hs-scripts.com" },
    { name: "Calendly", category: "support", needle: "assets.calendly.com" },
    { name: "Typeform", category: "support", needle: "embed.typeform.com" },
    { name: "Algolia", category: "support", needle: "algolia" },
    { name: "reCAPTCHA", category: "security", needle: "recaptcha" },
    { name: "hCaptcha", category: "security", needle: "hcaptcha.com" },
    { name: "jsDelivr", category: "cdn", needle: "cdn.jsdelivr.net" },
    { name: "cdnjs", category: "cdn", needle: "cdnjs.cloudflare.com" },
    { name: "Bootstrap", category: "framework", needle: "bootstrap.min" },
];

/** `<meta name="generator">` names the platform outright when present. */
const GENERATOR = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']{1,80})["']/iu;

export interface TechReport {
    url: string;
    finalUrl: string;
    status: number;
    server?: string;
    poweredBy?: string;
    generator?: string;
    technologies: Detection[];
    categories: Partial<Record<Category, string[]>>;
}

/** Apply a rule table, keeping the first evidence seen for each technology. */
function applyRules(rules: Rule[], haystack: string, found: Map<string, Detection>, label: (rule: Rule) => string): void {
    for (const rule of rules) {
        if (found.has(rule.name)) { continue; }
        if (haystack.includes(rule.needle)) {
            found.set(rule.name, { name: rule.name, category: rule.category, evidence: label(rule) });
        }
    }
}

/**
 * The whole detection, given raw header lines ("Name: value") and HTML. Kept
 * separate from the fetch so the rule tables can be exercised directly — they
 * are a pile of heuristics and are the part most likely to regress.
 */
export function fingerprint(headerLines: string[], html: string): {
    technologies: Detection[];
    categories: Partial<Record<Category, string[]>>;
    generator?: string;
} {
    const headerBlob = headerLines.join("\n").toLowerCase();
    const markup = html.toLowerCase();

    const found = new Map<string, Detection>();
    applyRules(HEADER_RULES, headerBlob, found, (rule) => {
        const line = headerLines.find((h) => h.toLowerCase().includes(rule.needle));
        return `header ${line ?? rule.needle}`.slice(0, 120);
    });
    applyRules(HTML_RULES, markup, found, (rule) => `html contains "${rule.needle}"`);

    const generator = GENERATOR.exec(markup)?.[1];
    if (generator) {
        const platform = generator.split(/[\s/]/u)[0] ?? generator;
        const name = platform.charAt(0).toUpperCase() + platform.slice(1);
        if (!found.has(name)) {
            found.set(name, { name, category: "cms", evidence: `meta generator "${generator}"` });
        }
    }

    const technologies = Array.from(found.values())
        .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

    const categories: Partial<Record<Category, string[]>> = {};
    for (const tech of technologies) {
        (categories[tech.category] ??= []).push(tech.name);
    }
    return { technologies, categories, generator };
}

export async function detectTech(url: string): Promise<TechReport> {
    const response = await safeFetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    const headerLines: string[] = [];
    response.headers.forEach((value, name) => { headerLines.push(`${name}: ${value}`); });

    // Only read HTML — a PDF or image has nothing to fingerprint and could be
    // arbitrarily large.
    const contentType = response.headers.get("content-type") ?? "";
    let html = "";
    if (contentType.includes("html") || contentType === "") {
        const text = await response.text();
        html = text.slice(0, MAX_HTML_BYTES);
    }

    const { technologies, categories, generator } = fingerprint(headerLines, html);

    return {
        url,
        finalUrl: response.url === "" ? url : response.url,
        status: response.status,
        server: response.headers.get("server") ?? undefined,
        poweredBy: response.headers.get("x-powered-by") ?? undefined,
        generator,
        technologies,
        categories,
    };
}
