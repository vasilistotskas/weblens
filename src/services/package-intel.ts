/**
 * Package intelligence for npm and PyPI.
 *
 * The question a coding agent actually has before adding a dependency is not
 * "what version is it" — it is "should I use this at all". That needs
 * deprecation status, release recency, maintainer count and popularity
 * together, which today means three or four separate registry calls plus the
 * judgement on top. This is one call.
 *
 * Both registries are free and unauthenticated, so the marginal cost is the
 * usual ~$0.000002 of Workers CPU.
 *
 * DELIBERATE OMISSION: PyPI download counts. The only free source is
 * pypistats.org, which returned 429 on a bare probe during development — a
 * field that works intermittently is worse than one that is documented as
 * absent, so PyPI reports metadata and maintenance only.
 */

const NPM_REGISTRY = "https://registry.npmjs.org";
const NPM_DOWNLOADS = "https://api.npmjs.org/downloads/point";
const PYPI = "https://pypi.org/pypi";
const TIMEOUT_MS = 8000;

/** Two years without a release is the usual "is this alive" threshold. */
const STALE_DAYS = 730;

export type Registry = "npm" | "pypi";

export interface PackageReport {
    name: string;
    registry: Registry;
    found: boolean;
    version?: string;
    description?: string;
    license?: string;
    homepage?: string;
    repository?: string;
    deprecated: boolean;
    deprecationReason?: string;
    downloads?: { lastWeek?: number; lastMonth?: number };
    maintenance: {
        lastPublishedAt?: string;
        daysSinceRelease?: number;
        maintainers?: number;
        /** npm's own 0-1 scores. Absent for PyPI, which publishes none. */
        scores?: { quality?: number; popularity?: number; maintenance?: number };
    };
    dependencies?: number;
    requiresPython?: string;
    signals: string[];
}

/**
 * Registry names are interpolated into upstream URLs, so they are validated
 * rather than escaped-and-hoped. npm allows one leading @scope/, lowercase
 * only; PyPI names are letters, digits, and . _ - per PEP 503.
 */
export function normalizePackageName(input: string, registry: Registry): string | null {
    const value = input.trim();
    if (value === "" || value.length > 214) { return null; }

    if (registry === "npm") {
        const ok = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(value.toLowerCase());
        return ok ? value.toLowerCase() : null;
    }
    return /^[a-z0-9][a-z0-9._-]*$/iu.test(value) ? value : null;
}

async function getJson<T>(url: string, accept = "application/json"): Promise<T | null> {
    try {
        const response = await fetch(url, {
            headers: { Accept: accept, "User-Agent": "WebLens/1.0 (+https://api.weblens.dev)" },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) { return null; }
        return await response.json<T>();
    } catch {
        return null;
    }
}

function daysSince(iso: string | undefined): number | undefined {
    if (!iso) { return undefined; }
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) { return undefined; }
    return Math.floor((Date.now() - then) / 86_400_000);
}

/** Normalise the many shapes a repository field takes into a plain URL. */
function repoUrl(repository: unknown): string | undefined {
    const raw = typeof repository === "string"
        ? repository
        : (repository as { url?: string } | null)?.url;
    if (typeof raw !== "string" || raw === "") { return undefined; }
    return raw.replace(/^git\+/u, "").replace(/\.git$/u, "");
}

/** Health flags — the judgement the caller is paying for. Exported for tests. */
export function buildSignals(report: Omit<PackageReport, "signals">): string[] {
    const signals: string[] = [];
    if (report.deprecated) { signals.push("deprecated"); }

    const days = report.maintenance.daysSinceRelease;
    if (days !== undefined && days > STALE_DAYS) { signals.push("no-recent-release"); }
    if (report.license === undefined || report.license === "") { signals.push("no-license"); }
    if (report.maintenance.maintainers === 1) { signals.push("single-maintainer"); }
    if (!report.repository) { signals.push("no-public-repository"); }
    if (!report.found) { signals.push("not-found"); }
    return signals;
}

// ============================================
// npm
// ============================================

interface NpmManifest {
    name?: string; version?: string; description?: string; homepage?: string;
    license?: string | { type?: string };
    repository?: unknown; deprecated?: string;
    dependencies?: Record<string, string>;
}
interface NpmSearchHit {
    package?: {
        date?: string;
        maintainers?: unknown[];
        links?: { repository?: string; homepage?: string };
    };
    score?: { detail?: { quality?: number; popularity?: number; maintenance?: number } };
}

async function inspectNpm(name: string): Promise<PackageReport> {
    const encoded = name.replace("/", "%2f");

    const [manifest, search, week, month] = await Promise.all([
        getJson<NpmManifest>(`${NPM_REGISTRY}/${encoded}/latest`),
        getJson<{ objects?: NpmSearchHit[] }>(`${NPM_REGISTRY}/-/v1/search?text=${encodeURIComponent(name)}&size=1`),
        getJson<{ downloads?: number }>(`${NPM_DOWNLOADS}/last-week/${encoded}`),
        getJson<{ downloads?: number }>(`${NPM_DOWNLOADS}/last-month/${encoded}`),
    ]);

    if (!manifest) {
        const missing: Omit<PackageReport, "signals"> = {
            name, registry: "npm", found: false, deprecated: false, maintenance: {},
        };
        return { ...missing, signals: buildSignals(missing) };
    }

    // Only trust the search hit if it is actually this package.
    const hit = search?.objects?.[0]?.package?.date !== undefined ? search.objects[0] : undefined;
    const license = typeof manifest.license === "string" ? manifest.license : manifest.license?.type;
    const lastPublishedAt = hit?.package?.date;

    const base: Omit<PackageReport, "signals"> = {
        name: manifest.name ?? name,
        registry: "npm",
        found: true,
        version: manifest.version,
        description: manifest.description,
        license,
        homepage: manifest.homepage ?? hit?.package?.links?.homepage,
        repository: repoUrl(manifest.repository) ?? hit?.package?.links?.repository,
        deprecated: typeof manifest.deprecated === "string",
        deprecationReason: typeof manifest.deprecated === "string" ? manifest.deprecated : undefined,
        downloads: { lastWeek: week?.downloads, lastMonth: month?.downloads },
        maintenance: {
            lastPublishedAt,
            daysSinceRelease: daysSince(lastPublishedAt),
            maintainers: hit?.package?.maintainers?.length,
            scores: hit?.score?.detail,
        },
        dependencies: Object.keys(manifest.dependencies ?? {}).length,
    };
    return { ...base, signals: buildSignals(base) };
}

// ============================================
// PyPI
// ============================================

interface PypiResponse {
    info?: {
        name?: string; version?: string; summary?: string; license?: string;
        home_page?: string; project_url?: string; requires_python?: string;
        requires_dist?: string[] | null; yanked?: boolean;
        project_urls?: Record<string, string> | null;
    };
    urls?: { upload_time_iso_8601?: string }[];
}

async function inspectPypi(name: string): Promise<PackageReport> {
    const data = await getJson<PypiResponse>(`${PYPI}/${encodeURIComponent(name)}/json`);

    if (!data?.info) {
        const missing: Omit<PackageReport, "signals"> = {
            name, registry: "pypi", found: false, deprecated: false, maintenance: {},
        };
        return { ...missing, signals: buildSignals(missing) };
    }

    const info = data.info;
    const projectUrls = info.project_urls ?? {};
    const repository = Object.entries(projectUrls)
        .find(([key]) => /source|repository|code|github/iu.test(key))?.[1];
    const lastPublishedAt = data.urls?.[0]?.upload_time_iso_8601;

    const base: Omit<PackageReport, "signals"> = {
        name: info.name ?? name,
        registry: "pypi",
        found: true,
        version: info.version,
        description: info.summary,
        license: info.license === "" ? undefined : info.license,
        homepage: info.home_page ?? info.project_url,
        repository: repoUrl(repository),
        // PyPI has no per-package deprecation flag; a yanked release is the
        // closest equivalent and means "do not use this version".
        deprecated: info.yanked === true,
        deprecationReason: info.yanked === true ? "Latest release is yanked on PyPI" : undefined,
        maintenance: {
            lastPublishedAt,
            daysSinceRelease: daysSince(lastPublishedAt),
        },
        dependencies: (info.requires_dist ?? []).length,
        requiresPython: info.requires_python ?? undefined,
    };
    return { ...base, signals: buildSignals(base) };
}

export function inspectPackage(name: string, registry: Registry): Promise<PackageReport> {
    return registry === "pypi" ? inspectPypi(name) : inspectNpm(name);
}
