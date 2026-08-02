/**
 * Hacker News discussion intelligence.
 *
 * "What did HN say about X" is a question agents ask constantly — for launch
 * monitoring, competitor tracking, technology due diligence — and answering it
 * today means scraping or hand-rolling Algolia queries. The API is free and
 * unauthenticated, so this is another sub-cent endpoint.
 *
 * The aggregates are the point: a raw hit list still leaves the caller to work
 * out whether a topic was discussed once in 2013 or forty times this year.
 */

const HN_SEARCH = "https://hn.algolia.com/api/v1";
const HN_ITEM = "https://news.ycombinator.com/item?id=";
const TIMEOUT_MS = 8000;

export interface Story {
    title: string;
    url?: string;
    points: number;
    comments: number;
    author?: string;
    postedAt?: string;
    discussionUrl: string;
}

export interface DiscussionReport {
    query: string;
    source: "hackernews";
    sort: "relevance" | "recent";
    stories: Story[];
    summary: {
        /** Total stories HN matched, which may exceed the returned page. */
        totalMatches: number;
        returned: number;
        /** Sums over the RETURNED stories, not all matches. */
        pointsReturned: number;
        commentsReturned: number;
        topDomains: { domain: string; count: number }[];
        firstSeen?: string;
        lastSeen?: string;
    };
}

interface AlgoliaHit {
    objectID?: string;
    title?: string | null;
    story_title?: string | null;
    url?: string | null;
    points?: number | null;
    num_comments?: number | null;
    author?: string | null;
    created_at?: string | null;
}

function domainOf(url: string | undefined): string | undefined {
    if (!url) { return undefined; }
    try { return new URL(url).hostname.replace(/^www\./u, ""); } catch { return undefined; }
}

export async function searchDiscussions(
    query: string,
    limit: number,
    sort: "relevance" | "recent",
): Promise<DiscussionReport> {
    const path = sort === "recent" ? "search_by_date" : "search";
    const url = `${HN_SEARCH}/${path}?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${String(limit)}`;

    const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "WebLens/1.0 (+https://api.weblens.dev)" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
        throw new Error(`Hacker News search failed with status ${String(response.status)}`);
    }

    const body = await response.json<{ hits?: AlgoliaHit[]; nbHits?: number }>();
    const hits = body.hits ?? [];

    const stories: Story[] = hits.map((hit) => ({
        title: hit.title ?? hit.story_title ?? "(untitled)",
        url: hit.url ?? undefined,
        points: hit.points ?? 0,
        comments: hit.num_comments ?? 0,
        author: hit.author ?? undefined,
        postedAt: hit.created_at ?? undefined,
        discussionUrl: `${HN_ITEM}${hit.objectID ?? ""}`,
    }));

    const domainCounts = new Map<string, number>();
    for (const story of stories) {
        const domain = domainOf(story.url);
        if (domain) { domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1); }
    }

    const dates = stories
        .map((s) => s.postedAt)
        .filter((d): d is string => typeof d === "string")
        .sort();

    return {
        query,
        source: "hackernews",
        sort,
        stories,
        summary: {
            totalMatches: body.nbHits ?? stories.length,
            returned: stories.length,
            pointsReturned: stories.reduce((sum, s) => sum + s.points, 0),
            commentsReturned: stories.reduce((sum, s) => sum + s.comments, 0),
            topDomains: Array.from(domainCounts.entries())
                .map(([domain, count]) => ({ domain, count }))
                .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
                .slice(0, 5),
            firstSeen: dates[0],
            lastSeen: dates[dates.length - 1],
        },
    };
}
