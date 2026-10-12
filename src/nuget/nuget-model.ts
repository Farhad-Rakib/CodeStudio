// Pure NuGet package model: versions, search-result mapping and update detection. No 'vscode' import.

export interface PackageSummary {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly authors: string;
  readonly totalDownloads: number;
  readonly iconUrl?: string;
  readonly projectUrl?: string;
  readonly licenseUrl?: string;
  readonly verified: boolean;
  readonly tags: readonly string[];
  readonly versions: readonly string[];
  /** Package source the summary came from (set by the panel). */
  readonly sourceName?: string;
  readonly sourceUrl?: string;
}

export interface InstalledPackage {
  readonly id: string;
  /** Undefined when the version is managed centrally (Directory.Packages.props). */
  readonly version?: string;
}

export interface PackageRow extends InstalledPackage {
  readonly latest?: string;
  readonly summary?: PackageSummary;
  readonly updateAvailable: boolean;
}

interface ParsedVersion {
  readonly nums: number[];
  readonly pre: string[];
}

function parse(v: string): ParsedVersion {
  const clean = v.trim().split('+')[0];
  const dash = clean.indexOf('-');
  const core = dash < 0 ? clean : clean.slice(0, dash);
  const pre = dash < 0 ? [] : clean.slice(dash + 1).split('.');
  const nums = core.split('.').map(n => Number.parseInt(n, 10) || 0);
  while (nums.length < 4) nums.push(0);
  return { nums, pre };
}

/** NuGet/SemVer 2 ordering: numeric parts, then release > prerelease, then prerelease labels. */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 4; i++) if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  if (pa.pre.length === 0 || pb.pre.length === 0) return pb.pre.length - pa.pre.length;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d;
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else {
      const d = x.toLowerCase().localeCompare(y.toLowerCase());
      if (d !== 0) return d;
    }
  }
  return 0;
}

export function isPrerelease(v: string): boolean {
  return v.split('+')[0].includes('-');
}

/** Highest version, optionally excluding prereleases. */
export function latestVersion(versions: readonly string[], includePrerelease: boolean): string | undefined {
  const candidates = versions.filter(v => includePrerelease || !isPrerelease(v));
  return candidates.sort(compareVersions).pop();
}

/** Versions newest first, for a version picker. */
export function sortVersionsDescending(versions: readonly string[], includePrerelease: boolean): string[] {
  return versions.filter(v => includePrerelease || !isPrerelease(v)).sort((a, b) => compareVersions(b, a));
}

/** An installed package has an update when a newer version exists (a pinned prerelease also sees newer prereleases). */
export function buildRows(installed: readonly InstalledPackage[], summaries: ReadonlyMap<string, PackageSummary>, includePrerelease: boolean): PackageRow[] {
  return installed
    .map(p => {
      const summary = summaries.get(p.id.toLowerCase());
      const allowPre = includePrerelease || (p.version !== undefined && isPrerelease(p.version));
      const latest = summary ? latestVersion(summary.versions.length ? summary.versions : [summary.version], allowPre) : undefined;
      const updateAvailable = !!(latest && p.version && compareVersions(latest, p.version) > 0);
      return { ...p, latest, summary, updateAvailable };
    })
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { sensitivity: 'base' }));
}

/** Maps one entry of the NuGet V3 search response. */
export function mapSearchEntry(e: Record<string, unknown>): PackageSummary | undefined {
  const id = typeof e.id === 'string' ? e.id : undefined;
  const version = typeof e.version === 'string' ? e.version : undefined;
  if (!id || !version) return undefined;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const authors = Array.isArray(e.authors) ? e.authors.filter(a => typeof a === 'string').join(', ') : str(e.authors) ?? '';
  const versions = Array.isArray(e.versions)
    ? e.versions.map(v => (v && typeof v === 'object' ? str((v as Record<string, unknown>).version) : undefined)).filter((v): v is string => !!v)
    : [];
  const safeUrl = (u: unknown) => {
    const s = str(u);
    return s && /^https:\/\//i.test(s) ? s : undefined;
  };
  return {
    id,
    version,
    description: str(e.description) ?? str(e.summary) ?? '',
    authors,
    totalDownloads: typeof e.totalDownloads === 'number' ? e.totalDownloads : 0,
    iconUrl: safeUrl(e.iconUrl),
    projectUrl: safeUrl(e.projectUrl),
    licenseUrl: safeUrl(e.licenseUrl),
    verified: e.verified === true,
    tags: Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === 'string') : [],
    versions,
  };
}

export function formatDownloads(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}
