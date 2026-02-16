/**
 * Intelligence Service
 * High-value, multi-step AI workflows (Knowledge Arbitrageur)
 *
 * Chains: search → batch fetch → AI extraction → structured output
 * Used by: /intel/company, /intel/market, /intel/competitive, /intel/site-audit
 */

import { fetchBasicPage } from "../tools/fetch-basic";
import type { AIServiceConfig } from "./ai";
import { callClaude } from "./ai";

// ============================================
// Types
// ============================================

export interface CompanyProfile {
    name: string;
    description: string;
    industry: string;
    website: string;
    techStack: string[];
    socialLinks: Record<string, string>;
    teamSizeEstimate: string;
    fundingInfo: string;
    recentNews: { title: string; date: string; source: string; summary: string }[];
    competitors: string[];
    keywords: string[];
}

export interface MarketReport {
    topic: string;
    executiveSummary: string;
    keyFindings: { finding: string; source: string; confidence: string }[];
    trends: string[];
    keyPlayers: { name: string; role: string }[];
    dataPoints: { metric: string; value: string; source: string }[];
    recommendedActions: string[];
    sources: { url: string; title: string }[];
}

export interface CompetitiveReport {
    company: string;
    competitors: { name: string; url: string; description: string }[];
    featureMatrix: Record<string, Record<string, string>>;
    pricingComparison: { company: string; model: string; details: string }[];
    swotAnalysis: { company: string; strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] }[];
    positioningSummary: string;
}

export interface SiteAudit {
    url: string;
    seoScore: number;
    metaTags: { title: string; description: string; ogImage: string; canonical: string; robots: string };
    headingStructure: { tag: string; text: string }[];
    contentQuality: { readabilityScore: number; wordCount: number; keywordDensity: Record<string, number> };
    techStack: string[];
    securityHeaders: Record<string, string>;
    issues: { severity: "critical" | "warning" | "info"; category: string; description: string; recommendation: string }[];
    overallRecommendations: string[];
}

// ============================================
// Search helper (reused from research service pattern)
// ============================================

interface SearchHit {
    title: string;
    url: string;
    snippet: string;
}

async function searchWeb(query: string, limit: number): Promise<SearchHit[]> {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const response = await fetch(searchUrl, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "text/html",
        },
    });

    if (!response.ok) {
        throw new Error(`Search failed: ${String(response.status)}`);
    }

    const html = await response.text();
    return parseDuckDuckGoResults(html, limit);
}

function parseDuckDuckGoResults(html: string, limit: number): SearchHit[] {
    const results: SearchHit[] = [];
    const resultRegex =
        /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]*)<\/a>/gi;

    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < limit) {
        const [, url, title, snippet] = match;
        if (url && title) {
            results.push({
                title: decodeEntities(title.trim()),
                url: decodeURIComponent(url),
                snippet: decodeEntities(snippet.trim()),
            });
        }
    }

    return results;
}

function decodeEntities(text: string): string {
    return text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ");
}

async function fetchPage(url: string): Promise<{ title: string; content: string; url: string }> {
    try {
        const result = await fetchBasicPage(url, 10000);
        return { title: result.title, content: result.content.slice(0, 8000), url };
    } catch {
        return { title: "", content: "", url };
    }
}

// ============================================
// Company Intelligence
// ============================================

export interface CompanyIntelOptions {
    target: string;
    aiConfig: AIServiceConfig;
}

export async function companyIntel(options: CompanyIntelOptions): Promise<CompanyProfile> {
    const { target, aiConfig } = options;

    // Step 1: Search for company info across multiple queries
    const [mainResults, techResults, newsResults] = await Promise.all([
        searchWeb(`${target} company about`, 5),
        searchWeb(`${target} technology stack engineering`, 3),
        searchWeb(`${target} news funding recent`, 3),
    ]);

    // Step 2: Fetch top pages in parallel
    const allUrls = [...mainResults, ...techResults, ...newsResults]
        .map((r) => r.url)
        .filter((url, i, arr) => arr.indexOf(url) === i)
        .slice(0, 8);

    const pages = await Promise.all(allUrls.map(fetchPage));
    const validPages = pages.filter((p) => p.content.length > 100);

    // Step 3: AI extraction
    const combinedContent = validPages
        .map((p) => `## ${p.title}\nURL: ${p.url}\n${p.content}`)
        .join("\n\n---\n\n");

    const systemPrompt = `You are a company intelligence analyst. Extract structured company information from web content.
Always respond with valid JSON matching this exact schema:
{
  "name": "Company Name",
  "description": "2-3 sentence description",
  "industry": "Primary industry",
  "website": "main website URL",
  "techStack": ["Technology 1", "Technology 2"],
  "socialLinks": {"twitter": "url", "linkedin": "url", "github": "url"},
  "teamSizeEstimate": "Estimated range like '50-200' or '1000+'",
  "fundingInfo": "Funding stage and amount if known, or 'Unknown'",
  "recentNews": [{"title": "...", "date": "YYYY-MM-DD or approximate", "source": "...", "summary": "1 sentence"}],
  "competitors": ["Competitor 1", "Competitor 2"],
  "keywords": ["keyword1", "keyword2"]
}
Be accurate. If information is not available, use empty strings/arrays rather than making things up.`;

    const prompt = `Analyze the following web content about "${target}" and extract a comprehensive company profile.

${combinedContent.slice(0, 20000)}

Respond ONLY with valid JSON.`;

    const response = await callClaude(aiConfig, prompt, systemPrompt);

    try {
        const parsed = JSON.parse(response) as Partial<CompanyProfile>;
        return {
            name: parsed.name ?? target,
            description: parsed.description ?? "",
            industry: parsed.industry ?? "",
            website: parsed.website ?? target,
            techStack: parsed.techStack ?? [],
            socialLinks: parsed.socialLinks ?? {},
            teamSizeEstimate: parsed.teamSizeEstimate ?? "Unknown",
            fundingInfo: parsed.fundingInfo ?? "Unknown",
            recentNews: parsed.recentNews ?? [],
            competitors: parsed.competitors ?? [],
            keywords: parsed.keywords ?? [],
        };
    } catch {
        throw new Error("Failed to parse company intelligence results");
    }
}

// ============================================
// Market Research
// ============================================

export interface MarketResearchOptions {
    topic: string;
    depth: "quick" | "standard" | "comprehensive";
    focus?: string;
    aiConfig: AIServiceConfig;
}

export async function marketResearch(options: MarketResearchOptions): Promise<MarketReport> {
    const { topic, depth, focus, aiConfig } = options;

    const searchCount = depth === "comprehensive" ? 10 : depth === "standard" ? 7 : 4;
    const fetchCount = depth === "comprehensive" ? 8 : depth === "standard" ? 5 : 3;

    // Step 1: Multi-angle search
    const queries = [
        `${topic} market analysis 2025 2026`,
        `${topic} trends industry report`,
        `${topic} key players companies`,
    ];
    if (depth !== "quick") {
        queries.push(`${topic} market size revenue statistics`);
    }

    const allResults: SearchHit[] = [];
    const searchPromises = queries.map((q) => searchWeb(q, searchCount));
    const searchBatches = await Promise.all(searchPromises);
    for (const batch of searchBatches) {
        for (const result of batch) {
            if (!allResults.some((r) => r.url === result.url)) {
                allResults.push(result);
            }
        }
    }

    // Step 2: Fetch top unique pages
    const topUrls = allResults.slice(0, fetchCount);
    const pages = await Promise.all(topUrls.map((r) => fetchPage(r.url)));
    const validPages = pages.filter((p) => p.content.length > 100);

    // Step 3: AI analysis
    const combinedContent = validPages
        .map((p) => `## ${p.title}\nURL: ${p.url}\n${p.content}`)
        .join("\n\n---\n\n");

    const systemPrompt = `You are a senior market research analyst. Produce a structured research report from web sources.
Always respond with valid JSON matching this exact schema:
{
  "topic": "Research topic",
  "executiveSummary": "2-3 paragraph executive summary",
  "keyFindings": [{"finding": "...", "source": "source URL or name", "confidence": "high/medium/low"}],
  "trends": ["Trend 1", "Trend 2"],
  "keyPlayers": [{"name": "Company", "role": "Their role in this market"}],
  "dataPoints": [{"metric": "Market size", "value": "$X billion", "source": "..."}],
  "recommendedActions": ["Action 1", "Action 2"],
  "sources": [{"url": "...", "title": "..."}]
}
Be thorough but accurate. Cite sources where possible. Mark confidence levels honestly.`;

    const focusInstruction = focus ? ` Focus especially on: "${focus}".` : "";
    const prompt = `Produce a ${depth} market research report on: "${topic}".${focusInstruction}

Based on the following ${String(validPages.length)} web sources:

${combinedContent.slice(0, 24000)}

Respond ONLY with valid JSON.`;

    const response = await callClaude(aiConfig, prompt, systemPrompt);

    try {
        const parsed = JSON.parse(response) as Partial<MarketReport>;
        return {
            topic: parsed.topic ?? topic,
            executiveSummary: parsed.executiveSummary ?? "",
            keyFindings: parsed.keyFindings ?? [],
            trends: parsed.trends ?? [],
            keyPlayers: parsed.keyPlayers ?? [],
            dataPoints: parsed.dataPoints ?? [],
            recommendedActions: parsed.recommendedActions ?? [],
            sources: parsed.sources ?? validPages.map((p) => ({ url: p.url, title: p.title })),
        };
    } catch {
        throw new Error("Failed to parse market research results");
    }
}

// ============================================
// Competitive Analysis
// ============================================

export interface CompetitiveAnalysisOptions {
    company: string;
    maxCompetitors: number;
    focus?: string;
    aiConfig: AIServiceConfig;
}

export async function competitiveAnalysis(options: CompetitiveAnalysisOptions): Promise<CompetitiveReport> {
    const { company, maxCompetitors, focus, aiConfig } = options;

    // Step 1: Find competitors
    const competitorResults = await searchWeb(`${company} competitors alternatives`, 8);

    // Also search for the company itself
    const [companyResults, pricingResults] = await Promise.all([
        searchWeb(`${company} features pricing`, 5),
        searchWeb(`${company} vs alternative comparison`, 5),
    ]);

    // Step 2: Fetch pages
    const allUrls = [...competitorResults, ...companyResults, ...pricingResults]
        .map((r) => r.url)
        .filter((url, i, arr) => arr.indexOf(url) === i)
        .slice(0, 10);

    const pages = await Promise.all(allUrls.map(fetchPage));
    const validPages = pages.filter((p) => p.content.length > 100);

    // Step 3: AI competitive analysis
    const combinedContent = validPages
        .map((p) => `## ${p.title}\nURL: ${p.url}\n${p.content}`)
        .join("\n\n---\n\n");

    const systemPrompt = `You are a competitive intelligence analyst. Analyze web content to produce a structured competitive report.
Always respond with valid JSON matching this exact schema:
{
  "company": "Target company name",
  "competitors": [{"name": "Competitor", "url": "website", "description": "1-2 sentence description"}],
  "featureMatrix": {"FeatureName": {"Company1": "Yes/No/Details", "Company2": "Yes/No/Details"}},
  "pricingComparison": [{"company": "Name", "model": "Pricing model", "details": "Price details"}],
  "swotAnalysis": [{"company": "Name", "strengths": [...], "weaknesses": [...], "opportunities": [...], "threats": [...]}],
  "positioningSummary": "2-3 paragraph competitive positioning summary"
}
Limit competitors to the top ${String(maxCompetitors)} most relevant. Be accurate and specific.`;

    const focusInstruction = focus ? ` Focus especially on: "${focus}".` : "";
    const prompt = `Produce a competitive analysis for "${company}".${focusInstruction}
Include up to ${String(maxCompetitors)} top competitors.

Based on the following web sources:

${combinedContent.slice(0, 24000)}

Respond ONLY with valid JSON.`;

    const response = await callClaude(aiConfig, prompt, systemPrompt);

    try {
        const parsed = JSON.parse(response) as Partial<CompetitiveReport>;
        return {
            company: parsed.company ?? company,
            competitors: (parsed.competitors ?? []).slice(0, maxCompetitors),
            featureMatrix: parsed.featureMatrix ?? {},
            pricingComparison: parsed.pricingComparison ?? [],
            swotAnalysis: parsed.swotAnalysis ?? [],
            positioningSummary: parsed.positioningSummary ?? "",
        };
    } catch {
        throw new Error("Failed to parse competitive analysis results");
    }
}

// ============================================
// Site Audit
// ============================================

export interface SiteAuditOptions {
    url: string;
    aiConfig: AIServiceConfig;
}

export async function siteAudit(options: SiteAuditOptions): Promise<SiteAudit> {
    const { url, aiConfig } = options;

    // Step 1: Fetch the page
    const page = await fetchPage(url);
    if (!page.content || page.content.length < 50) {
        throw new Error(`Failed to fetch content from ${url}`);
    }

    // Step 2: Also fetch the raw HTML for technical analysis
    let rawHtml = "";
    try {
        const htmlResponse = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                Accept: "text/html",
            },
        });
        if (htmlResponse.ok) {
            rawHtml = (await htmlResponse.text()).slice(0, 15000);
        }
    } catch {
        // Continue with markdown content only
    }

    // Step 3: AI audit
    const systemPrompt = `You are an expert SEO and web performance auditor. Analyze web pages and produce detailed audit reports.
Always respond with valid JSON matching this exact schema:
{
  "url": "audited URL",
  "seoScore": 75,
  "metaTags": {"title": "...", "description": "...", "ogImage": "...", "canonical": "...", "robots": "..."},
  "headingStructure": [{"tag": "h1", "text": "..."}],
  "contentQuality": {"readabilityScore": 80, "wordCount": 1500, "keywordDensity": {"keyword": 0.02}},
  "techStack": ["React", "Next.js", "Tailwind"],
  "securityHeaders": {"content-security-policy": "present/missing", "x-frame-options": "present/missing"},
  "issues": [{"severity": "critical", "category": "SEO", "description": "...", "recommendation": "..."}],
  "overallRecommendations": ["Recommendation 1", "Recommendation 2"]
}
seoScore should be 0-100. Be specific and actionable with recommendations.
Severity must be one of: "critical", "warning", "info".`;

    const prompt = `Perform a comprehensive SEO and site audit for: ${url}

Page title: ${page.title}

Markdown content (rendered):
${page.content.slice(0, 10000)}

Raw HTML (partial):
${rawHtml.slice(0, 10000)}

Analyze: meta tags, heading structure, content quality, tech stack detection, security headers, and identify issues with actionable recommendations. Score the overall SEO quality 0-100.

Respond ONLY with valid JSON.`;

    const response = await callClaude(aiConfig, prompt, systemPrompt);

    try {
        const parsed = JSON.parse(response) as Partial<SiteAudit>;
        return {
            url: parsed.url ?? url,
            seoScore: parsed.seoScore ?? 0,
            metaTags: parsed.metaTags ?? { title: "", description: "", ogImage: "", canonical: "", robots: "" },
            headingStructure: parsed.headingStructure ?? [],
            contentQuality: parsed.contentQuality ?? { readabilityScore: 0, wordCount: 0, keywordDensity: {} },
            techStack: parsed.techStack ?? [],
            securityHeaders: parsed.securityHeaders ?? {},
            issues: parsed.issues ?? [],
            overallRecommendations: parsed.overallRecommendations ?? [],
        };
    } catch {
        throw new Error("Failed to parse site audit results");
    }
}
