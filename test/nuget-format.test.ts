import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isRootEditorConfig, mergeEditorConfigs } from '../src/format/editorconfig-chain';
import { NuGetClient } from '../src/nuget/nuget-client';
import { buildRows, compareVersions, formatDownloads, latestVersion, mapSearchEntry, sortVersionsDescending } from '../src/nuget/nuget-model';

describe('NuGet versions', () => {
  it('orders versions like NuGet (numeric, release > prerelease, prerelease labels)', () => {
    const sorted = ['1.0.0', '1.0.0-beta.2', '1.0.0-beta.10', '1.0.0-alpha', '0.9.9', '1.0.0.1', '10.0.0', '2.0.0-rc.1'].sort(compareVersions);
    assert.deepEqual(sorted, ['0.9.9', '1.0.0-alpha', '1.0.0-beta.2', '1.0.0-beta.10', '1.0.0', '1.0.0.1', '2.0.0-rc.1', '10.0.0']);
    assert.equal(compareVersions('1.0', '1.0.0.0'), 0);
    assert.equal(compareVersions('1.0.0+build5', '1.0.0'), 0);
  });

  it('picks the latest stable or prerelease version', () => {
    const v = ['12.0.3', '13.0.1', '13.0.3', '14.0.0-preview.1'];
    assert.equal(latestVersion(v, false), '13.0.3');
    assert.equal(latestVersion(v, true), '14.0.0-preview.1');
    assert.deepEqual(sortVersionsDescending(v, false), ['13.0.3', '13.0.1', '12.0.3']);
  });

  it('computes update rows (central versions never show updates; pinned prereleases see newer prereleases)', () => {
    const summary = (id: string, versions: string[]) => mapSearchEntry({ id, version: versions[versions.length - 1], versions: versions.map(version => ({ version })) })!;
    const summaries = new Map([
      ['serilog', summary('Serilog', ['3.0.0', '4.0.0'])],
      ['polly', summary('Polly', ['8.0.0', '9.0.0-beta.1'])],
      ['dapper', summary('Dapper', ['2.1.0'])],
    ]);
    const rows = buildRows([{ id: 'Serilog', version: '3.0.0' }, { id: 'polly', version: '9.0.0-alpha.1' }, { id: 'Dapper' }, { id: 'Unknown', version: '1.0.0' }], summaries, false);
    const byId = new Map(rows.map(r => [r.id, r]));
    assert.deepEqual([byId.get('Serilog')!.latest, byId.get('Serilog')!.updateAvailable], ['4.0.0', true]);
    assert.deepEqual([byId.get('polly')!.latest, byId.get('polly')!.updateAvailable], ['9.0.0-beta.1', true]);
    assert.equal(byId.get('Dapper')!.updateAvailable, false);
    assert.equal(byId.get('Unknown')!.latest, undefined);
    assert.deepEqual(rows.map(r => r.id), ['Dapper', 'polly', 'Serilog', 'Unknown']);
  });

  it('maps search entries defensively and only keeps https links', () => {
    const p = mapSearchEntry({ id: 'A', version: '1.0.0', authors: ['x', 'y'], iconUrl: 'javascript:alert(1)', projectUrl: 'https://a.example', totalDownloads: 1500, verified: true, versions: [{ version: '1.0.0' }, {}] })!;
    assert.equal(p.authors, 'x, y');
    assert.equal(p.iconUrl, undefined);
    assert.equal(p.projectUrl, 'https://a.example');
    assert.deepEqual(p.versions, ['1.0.0']);
    assert.equal(mapSearchEntry({ version: '1.0.0' }), undefined);
    assert.equal(formatDownloads(1_234_567), '1.2M');
  });
});

describe('NuGetClient', () => {
  const fakeFetch = (log: string[]) => async (url: string) => {
    log.push(url);
    const body = url.endsWith('index.json')
      ? { resources: [{ '@id': 'https://search.example/query', '@type': 'SearchQueryService/3.5.0' }] }
      : { totalHits: 1, data: [{ id: 'Serilog', version: '4.0.0', versions: [{ version: '4.0.0' }] }] };
    return { ok: true, status: 200, json: async () => body };
  };

  it('resolves the search service once and builds the query', async () => {
    const log: string[] = [];
    const client = new NuGetClient('https://feed.example/index.json', fakeFetch(log));
    const res = await client.search('serilog', { take: 5, prerelease: true });
    await client.getPackage('Serilog');
    assert.equal(res.items[0].id, 'Serilog');
    assert.equal(log.filter(u => u.endsWith('index.json')).length, 1);
    const q = new URL(log[1]);
    assert.equal(q.searchParams.get('q'), 'serilog');
    assert.equal(q.searchParams.get('take'), '5');
    assert.equal(q.searchParams.get('prerelease'), 'true');
    assert.equal(new URL(log[2]).searchParams.get('q'), 'packageid:Serilog');
  });

  it('reports HTTP failures', async () => {
    const client = new NuGetClient('https://feed.example/index.json', async () => ({ ok: false, status: 503, json: async () => ({}) }));
    await assert.rejects(client.search('x'), /HTTP 503/);
  });
});

describe('formatter .editorconfig chain', () => {
  it('detects root files and merges outermost-first with editor indentation as the lowest priority', () => {
    assert.ok(isRootEditorConfig('# c\nroot = true\n[*]\n'));
    assert.ok(!isRootEditorConfig('[*]\nroot = true\n'));
    const merged = mergeEditorConfigs(['root = true\n[*.cs]\nindent_size = 2\n', '[*.cs]\nindent_size = 3\n'], { insertSpaces: true, tabSize: 4 });
    assert.equal((merged.match(/^root = true$/gm) ?? []).length, 1);
    const sizes = [...merged.matchAll(/indent_size = (\d)/g)].map(m => m[1]);
    assert.deepEqual(sizes, ['4', '2', '3'], 'fallback first, nearest file last (wins)');
    assert.match(mergeEditorConfigs([], { insertSpaces: false, tabSize: 8 }), /indent_style = tab\nindent_size = 8/);
  });
});
