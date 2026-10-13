/**
 * A company's open roles, read from its public job board.
 *
 * Greenhouse, Lever and Ashby each publish a company's listed jobs through an
 * unauthenticated API (verified 2026-10-13):
 *   Greenhouse  GET boards-api.greenhouse.io/v1/boards/{token}/jobs   → { jobs, meta.total }
 *               ("authentication is not required for any GET endpoints", docs.greenhouse.io/job-board.html)
 *   Lever       GET api.lever.co/v0/postings/{site}?mode=json        → [posting] (EU: api.eu.lever.co)
 *   Ashby       GET api.ashbyhq.com/posting-api/job-board/{name}     → { jobs }, `isListed` per job
 * The board is found from the links a careers page carries, in the forms
 * companies actually use (job-boards.greenhouse.io/vercel/..., boards.greenhouse.io/figma/...,
 * jobs.lever.co/palantir/..., jobs.ashbyhq.com/Linear/...). Sites that render
 * jobs some other way simply have no board here.
 */

import { BOT_USER_AGENT } from "../config";
import { asRecords, isRecord, str } from "../utils/narrow";
import { readTextCapped, safeFetch } from "../utils/safe-fetch";

export type JobBoardProvider = "greenhouse" | "lever" | "ashby";

export interface JobBoard {
    provider: JobBoardProvider;
    /** The company's board name on that provider. */
    token: string;
    /** Lever hosts EU customers on separate hosts. */
    eu: boolean;
}

export interface OpenRole {
    title: string;
    location?: string;
    team?: string;
    url?: string;
}

export interface Hiring {
    provider: JobBoardProvider;
    boardUrl: string;
    openRoles: number;
    /** Most common teams/departments, when the provider reports them. */
    topTeams: { name: string; roles: number }[];
    topLocations: { name: string; roles: number }[];
    /** The first roles as listed, for a feel of what is being hired. */
    sample: OpenRole[];
}

const TOKEN = "([A-Za-z0-9][A-Za-z0-9_.-]{0,99})";

/** Earlier patterns win: an embed URL names its board in `for=`, not in the path. */
const BOARD_PATTERNS: { provider: JobBoardProvider; eu: boolean; pattern: RegExp }[] = [
    { provider: "greenhouse", eu: false, pattern: new RegExp(`greenhouse\\.io/embed/job_board(?:/js)?\\?for=${TOKEN}`, "u") },
    { provider: "greenhouse", eu: false, pattern: new RegExp(`(?:job-boards|boards)\\.greenhouse\\.io/(?!embed\\b)${TOKEN}`, "u") },
    { provider: "lever", eu: true, pattern: new RegExp(`jobs\\.eu\\.lever\\.co/${TOKEN}`, "u") },
    { provider: "lever", eu: false, pattern: new RegExp(`jobs\\.lever\\.co/${TOKEN}`, "u") },
    { provider: "ashby", eu: false, pattern: new RegExp(`jobs\\.ashbyhq\\.com/${TOKEN}`, "u") },
];

/** The job board a page links to, if it links to one we can read. */
export function findJobBoard(html: string): JobBoard | undefined {
    for (const { provider, eu, pattern } of BOARD_PATTERNS) {
        const token = pattern.exec(html)?.[1];
        if (token) { return { provider, token, eu }; }
    }
    return undefined;
}

function boardUrls(board: JobBoard): { api: string; hosted: string } {
    const token = encodeURIComponent(board.token);
    switch (board.provider) {
        case "greenhouse":
            return { api: `https://boards-api.greenhouse.io/v1/boards/${token}/jobs`, hosted: `https://job-boards.greenhouse.io/${token}` };
        case "lever": {
            const region = board.eu ? ".eu" : "";
            return { api: `https://api${region}.lever.co/v0/postings/${token}?mode=json`, hosted: `https://jobs${region}.lever.co/${token}` };
        }
        case "ashby":
            return { api: `https://api.ashbyhq.com/posting-api/job-board/${token}`, hosted: `https://jobs.ashbyhq.com/${token}` };
    }
}

/** Every listed role in a provider's response, normalised. */
export function parseRoles(provider: JobBoardProvider, data: unknown): OpenRole[] {
    switch (provider) {
        case "greenhouse":
            return asRecords(isRecord(data) ? data.jobs : undefined).map((job) => ({
                title: str(job.title) ?? "",
                location: isRecord(job.location) ? str(job.location.name) : undefined,
                url: str(job.absolute_url),
            }));
        case "lever":
            return asRecords(data).map((posting) => {
                const categories = isRecord(posting.categories) ? posting.categories : {};
                return {
                    title: str(posting.text) ?? "",
                    location: str(categories.location),
                    team: str(categories.team) ?? str(categories.department),
                    url: str(posting.hostedUrl),
                };
            });
        case "ashby":
            return asRecords(isRecord(data) ? data.jobs : undefined)
                .filter((job) => job.isListed !== false)
                .map((job) => ({
                    title: str(job.title) ?? "",
                    location: str(job.location),
                    team: str(job.department) ?? str(job.team),
                    url: str(job.jobUrl),
                }));
    }
}

function topCounts(values: (string | undefined)[], limit: number): { name: string; roles: number }[] {
    const counts = new Map<string, number>();
    for (const value of values) {
        if (value) { counts.set(value, (counts.get(value) ?? 0) + 1); }
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([name, roles]) => ({ name, roles }));
}

/** Summarise a board's listed roles. */
export function summariseHiring(board: JobBoard, roles: OpenRole[], sampleSize: number): Hiring {
    const listed = roles.filter((role) => role.title !== "");
    return {
        provider: board.provider,
        boardUrl: boardUrls(board).hosted,
        openRoles: listed.length,
        topTeams: topCounts(listed.map((role) => role.team), 5),
        topLocations: topCounts(listed.map((role) => role.location), 5),
        sample: listed.slice(0, sampleSize),
    };
}

/**
 * The board's open roles, or undefined when the board does not answer (a
 * stale link, a renamed board). Lever and Ashby return full job descriptions,
 * so the read is capped like any other document.
 */
export async function fetchHiring(
    board: JobBoard,
    limits: { timeoutMs: number; sampleRoles: number; maxBoardBytes: number },
): Promise<Hiring | undefined> {
    try {
        const response = await safeFetch(boardUrls(board).api, {
            headers: { "User-Agent": BOT_USER_AGENT, Accept: "application/json" },
            signal: AbortSignal.timeout(limits.timeoutMs),
        });
        if (!response.ok) { return undefined; }
        const data: unknown = JSON.parse(await readTextCapped(response, limits.maxBoardBytes));
        return summariseHiring(board, parseRoles(board.provider, data), limits.sampleRoles);
    } catch {
        return undefined;
    }
}
