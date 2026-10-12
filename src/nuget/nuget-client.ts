// Minimal NuGet V3 client for nuget.org-compatible feeds. No 'vscode' import.
import { mapSearchEntry, PackageSummary } from './nuget-model';

export const NUGET_ORG_INDEX = 'https://api.nuget.org/v3/index.json';

export class NuGetAuthError extends Error {
  constructor(readonly status: number, url: string) {
    super(
      /nuget\.pkg\.github\.com/i.test(url)
        ? `GitHub Packages rejected the credentials (HTTP ${status}). The token needs the read:packages scope and, for organizations using SSO, must be authorized for that organization.`
        : `The feed requires credentials (HTTP ${status}): ${url}`,
    );
    this.name = 'NuGetAuthError';
  }
}

type Fetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class NuGetClient {
  private index: Promise<{ search: string; registrations?: string }> | undefined;

  constructor(
    private readonly indexUrl: string = NUGET_ORG_INDEX,
    private readonly fetchImpl: Fetch = (url, init) => fetch(url, init),
    private readonly timeoutMs = 20000,
    /** Authorization header value for private feeds (e.g. "Basic ..."). */
    private readonly authorization?: string,
  ) {}

  /** Basic auth header for a feed user name and password / personal access token. */
  static basicAuth(username: string | undefined, password: string): string {
    return 'Basic ' + Buffer.from(`${username || 'user'}:${password}`).toString('base64');
  }

  private async getJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (this.authorization) headers.Authorization = this.authorization;
      const res = await this.fetchImpl(url, { signal: controller.signal, headers });
      if (res.status === 401 || res.status === 403) throw new NuGetAuthError(res.status, url);
      if (!res.ok) throw new Error(`NuGet request failed (HTTP ${res.status}): ${url}`);
      return await res.json();
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new Error(`NuGet request timed out: ${url}`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private resolveIndex(): Promise<{ search: string; registrations?: string }> {
    if (!this.index) {
      this.index = this.getJson(this.indexUrl).then(index => {
        const resources = (index as { resources?: { '@id'?: string; '@type'?: string }[] }).resources ?? [];
        const search = resources.find(r => r['@type']?.startsWith('SearchQueryService'));
        const registrations = resources.find(r => r['@type']?.startsWith('RegistrationsBaseUrl'))?.['@id'];
        if (!search?.['@id']) throw new Error(`The NuGet feed ${this.indexUrl} does not expose a V3 search service (V2 feeds are not supported for browsing).`);
        return { search: search['@id'], registrations };
      });
      this.index.catch(() => (this.index = undefined));
    }
    return this.index;
  }

  async search(query: string, options: { skip?: number; take?: number; prerelease?: boolean } = {}): Promise<{ total: number; items: PackageSummary[] }> {
    const base = (await this.resolveIndex()).search;
    const params = new URLSearchParams({
      q: query,
      skip: String(options.skip ?? 0),
      take: String(options.take ?? 25),
      prerelease: String(options.prerelease ?? false),
      semVerLevel: '2.0.0',
    });
    const data = (await this.getJson(`${base}?${params}`)) as { totalHits?: number; data?: Record<string, unknown>[] };
    const items = (data.data ?? []).map(mapSearchEntry).filter((p): p is PackageSummary => !!p);
    return { total: data.totalHits ?? items.length, items };
  }

  /** Exact-id lookup through the search service (returns all versions). */
  async getPackage(id: string, prerelease = true): Promise<PackageSummary | undefined> {
    const { items } = await this.search(`packageid:${id}`, { take: 1, prerelease });
    const hit = items.find(p => p.id.toLowerCase() === id.toLowerCase());
    // Some feeds (GitHub Packages, Azure Artifacts) ignore the packageid: syntax; use the registration index.
    return hit ?? (await this.getFromRegistration(id, prerelease));
  }

  private async getFromRegistration(id: string, prerelease: boolean): Promise<PackageSummary | undefined> {
    const base = (await this.resolveIndex()).registrations;
    if (!base) return undefined;
    let index: { items?: { '@id'?: string; items?: { catalogEntry?: Record<string, unknown> }[] }[] };
    try {
      index = (await this.getJson(`${base.replace(/\/?$/, '/')}${encodeURIComponent(id.toLowerCase())}/index.json`)) as typeof index;
    } catch (err) {
      if (err instanceof NuGetAuthError) throw err;
      return undefined; // 404: not on this feed
    }
    const entries: Record<string, unknown>[] = [];
    for (const page of index.items ?? []) {
      // Large packages page their versions out; fetch pages that were not inlined.
      const items = page.items ?? (page['@id'] ? ((await this.getJson(page['@id'])) as { items?: { catalogEntry?: Record<string, unknown> }[] }).items : []);
      for (const leaf of items ?? []) if (leaf.catalogEntry && leaf.catalogEntry.listed !== false) entries.push(leaf.catalogEntry);
    }
    const candidates = entries.filter(e => prerelease || !String(e.version ?? '').includes('-'));
    const pick = candidates[candidates.length - 1] ?? entries[entries.length - 1];
    if (!pick) return undefined;
    return mapSearchEntry({
      ...pick,
      id: typeof pick.id === 'string' ? pick.id : id,
      versions: entries.map(e => ({ version: e.version })),
    });
  }
}
