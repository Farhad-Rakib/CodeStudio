// Minimal NuGet V3 client for nuget.org-compatible feeds. No 'vscode' import.
import { mapSearchEntry, PackageSummary } from './nuget-model';

export const NUGET_ORG_INDEX = 'https://api.nuget.org/v3/index.json';

type Fetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class NuGetClient {
  private searchUrl: Promise<string> | undefined;

  constructor(
    private readonly indexUrl: string = NUGET_ORG_INDEX,
    private readonly fetchImpl: Fetch = (url, init) => fetch(url, init),
    private readonly timeoutMs = 20000,
  ) {}

  private async getJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`NuGet request failed (HTTP ${res.status}): ${url}`);
      return await res.json();
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw new Error(`NuGet request timed out: ${url}`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private resolveSearchUrl(): Promise<string> {
    if (!this.searchUrl) {
      this.searchUrl = this.getJson(this.indexUrl).then(index => {
        const resources = (index as { resources?: { '@id'?: string; '@type'?: string }[] }).resources ?? [];
        const search = resources.find(r => r['@type']?.startsWith('SearchQueryService'));
        if (!search?.['@id']) throw new Error('The NuGet feed does not expose a search service.');
        return search['@id'];
      });
      this.searchUrl.catch(() => (this.searchUrl = undefined));
    }
    return this.searchUrl;
  }

  async search(query: string, options: { skip?: number; take?: number; prerelease?: boolean } = {}): Promise<{ total: number; items: PackageSummary[] }> {
    const base = await this.resolveSearchUrl();
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
    return items.find(p => p.id.toLowerCase() === id.toLowerCase());
  }
}
