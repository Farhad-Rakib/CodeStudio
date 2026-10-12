import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addNuGetSourceArgs, DotnetArgumentError, nugetSourceVerbArgs, updateNuGetSourceCredentialsArgs } from '../src/dotnet/dotnet-args';
import { NuGetAuthError, NuGetClient, NUGET_ORG_INDEX } from '../src/nuget/nuget-client';
import { mergeNuGetConfigs, nugetConfigCandidates, parseNuGetConfig, validateSourceUrl } from '../src/nuget/nuget-sources';

const userXml = `<?xml version="1.0"?>
<configuration>
  <packageSources>
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" protocolVersion="3" />
    <add key="Old Feed" value="https://old.example/v3/index.json" />
  </packageSources>
  <packageSourceCredentials>
    <Old_x0020_Feed><add key="Username" value="me" /><add key="ClearTextPassword" value="%OLD_TOKEN%" /></Old_x0020_Feed>
  </packageSourceCredentials>
</configuration>`;

const repoXml = `<configuration>
  <packageSources>
    <!-- <add key="commented" value="https://nope" /> -->
    <add key="Contoso" value="https://pkgs.dev.azure.com/contoso/_packaging/main/nuget/v3/index.json" />
    <add key="local" value="./packages" />
  </packageSources>
  <disabledPackageSources><add key="Old Feed" value="true" /></disabledPackageSources>
  <packageSourceCredentials>
    <Contoso><add key="Username" value="az" /><add key="ClearTextPassword" value="p&amp;t" /></Contoso>
  </packageSourceCredentials>
</configuration>`;

describe('NuGet package sources', () => {
  it('merges the config chain: closer configs add/override, credentials, disabled, relative paths', () => {
    const user = { file: '/home/u/.nuget/NuGet/NuGet.Config', config: parseNuGetConfig(userXml, { OLD_TOKEN: 'tok' }) };
    const repo = { file: '/repo/nuget.config', config: parseNuGetConfig(repoXml) };
    const merged = mergeNuGetConfigs([repo, user]);
    assert.deepEqual(merged.map(s => [s.name, s.enabled]), [['nuget.org', true], ['Old Feed', false], ['Contoso', true], ['local', true]]);
    assert.equal(merged[1].password, 'tok');
    assert.equal(merged[2].username, 'az');
    assert.equal(merged[2].password, 'p&t');
    assert.equal(merged[2].configFile, '/repo/nuget.config');
    assert.equal(merged[3].url, '/repo/packages');
  });

  it('honors <clear/> and defaults to nuget.org without configs', () => {
    const cleared = parseNuGetConfig('<configuration><packageSources><clear /><add key="Only" value="https://only/v3/index.json" /></packageSources></configuration>');
    const user = { file: '/u/NuGet.Config', config: parseNuGetConfig(userXml) };
    assert.deepEqual(mergeNuGetConfigs([{ file: '/r/nuget.config', config: cleared }, user]).map(s => s.name), ['Only']);
    assert.deepEqual(mergeNuGetConfigs([]).map(s => s.url), [NUGET_ORG_INDEX]);
  });

  it('lists candidate config files closest first, then the user config', () => {
    const c = nugetConfigCandidates('/a/b', 'darwin', {}, '/Users/me');
    assert.equal(c[0], '/a/b/nuget.config');
    assert.ok(c.includes('/nuget.config'));
    assert.equal(c[c.length - 1], '/Users/me/.nuget/NuGet/NuGet.Config');
  });

  it('builds dotnet nuget source arguments safely', () => {
    assert.deepEqual(addNuGetSourceArgs('https://f/v3/index.json', 'My Feed', { configFile: '/r/nuget.config' }),
      ['nuget', 'add', 'source', 'https://f/v3/index.json', '-n', 'My Feed', '--configfile', '/r/nuget.config']);
    assert.deepEqual(updateNuGetSourceCredentialsArgs('Feed', 'u', 'pat'), ['nuget', 'update', 'source', 'Feed', '-u', 'u', '-p', 'pat', '--store-password-in-clear-text']);
    assert.deepEqual(nugetSourceVerbArgs('disable', 'Feed'), ['nuget', 'disable', 'source', 'Feed']);
    assert.throws(() => addNuGetSourceArgs('file:///x', 'F'), DotnetArgumentError);
    assert.throws(() => nugetSourceVerbArgs('remove', '-x'), DotnetArgumentError);
    assert.ok(validateSourceUrl('ftp://x'));
    assert.equal(validateSourceUrl('https://x/v3/index.json'), undefined);
  });

  it('sends basic auth and reports 401 as NuGetAuthError', async () => {
    const seen: (string | undefined)[] = [];
    const client = new NuGetClient('https://feed/index.json', async (_url, init) => {
      seen.push(init?.headers?.Authorization);
      return { ok: false, status: 401, json: async () => ({}) };
    }, 1000, NuGetClient.basicAuth('u', 'p'));
    await assert.rejects(client.search('x'), NuGetAuthError);
    assert.equal(seen[0], 'Basic ' + Buffer.from('u:p').toString('base64'));
  });
});

describe('NuGet webview script', () => {
  it('is valid JavaScript after template rendering', async () => {
    const { renderNuGetHtml } = await import('../src/nuget/nuget-webview-html');
    const js = renderNuGetHtml('csp', 'N').split('<script nonce="N">')[1].split('</script>')[0];
    assert.doesNotThrow(() => new Function(js));
  });
});

describe('NuGet registration fallback', () => {
  it('finds a package via RegistrationsBaseUrl when search ignores packageid:', async () => {
    const responses: Record<string, unknown> = {
      'https://feed/index.json': { resources: [{ '@id': 'https://feed/query', '@type': 'SearchQueryService' }, { '@id': 'https://feed/reg/', '@type': 'RegistrationsBaseUrl/3.6.0' }] },
      'https://feed/reg/contoso.core/index.json': { items: [{ items: [
        { catalogEntry: { id: 'Contoso.Core', version: '1.0.0', authors: 'Contoso' } },
        { catalogEntry: { id: 'Contoso.Core', version: '1.1.0' } },
        { catalogEntry: { id: 'Contoso.Core', version: '2.0.0-beta' } },
      ] }] },
    };
    const client = new NuGetClient('https://feed/index.json', async url => {
      if (url.startsWith('https://feed/query')) return { ok: true, status: 200, json: async () => ({ totalHits: 1, data: [{ id: 'Other', version: '1.0.0' }] }) };
      const body = responses[url];
      return { ok: !!body, status: body ? 200 : 404, json: async () => body };
    });
    const pkg = await client.getPackage('Contoso.Core', false);
    assert.equal(pkg?.version, '1.1.0');
    assert.deepEqual(pkg?.versions, ['1.0.0', '1.1.0', '2.0.0-beta']);
    assert.equal(await client.getPackage('Missing', true), undefined);
  });
});
