import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { configurationArgs, runProjectArgs, targetPathArgs, targetVerbArgs } from '../src/dotnet/dotnet-args';
import {
  configurationLabel,
  DEFAULT_CONFIGURATIONS,
  parseConfigurationKey,
  resolveActiveConfiguration,
} from '../src/solution/build-configuration';
import { parseSln, parseSlnx, readSolution } from '../src/solution/solution-reader';
import { EMPTY_LAYOUT, JsonLayoutStore, LayoutError, setActiveConfiguration, validateLayout } from '../src/storage/layout-store';

const FIXTURES = path.resolve(__dirname, '../../test/fixtures');
const SLN_HEADER = 'Microsoft Visual Studio Solution File, Format Version 12.00\n';
const debug = { configuration: 'Debug', platform: 'Any CPU' };
const releaseX64 = { configuration: 'Release', platform: 'x64' };

describe('build configurations', () => {
  it('reads solution configurations from .sln files', async () => {
    const model = await readSolution(path.join(FIXTURES, 'Sample.sln'));
    assert.deepEqual(model.configurations, [debug, { configuration: 'Release', platform: 'Any CPU' }]);
  });

  it('reads custom configurations and platforms from .sln, ignoring duplicates', () => {
    const text = `${SLN_HEADER}Global
\tGlobalSection(SolutionConfigurationPlatforms) = preSolution
\t\tDebug|x64 = Debug|x64
\t\tStaging|x64 = Staging|x64
\t\tdebug|X64 = debug|X64
\tEndGlobalSection
EndGlobal
`;
    const model = parseSln(text, path.resolve('/repo/App.sln'));
    assert.deepEqual(model.configurations, [{ configuration: 'Debug', platform: 'x64' }, { configuration: 'Staging', platform: 'x64' }]);
  });

  it('falls back to Debug and Release when a .sln declares none', () => {
    const model = parseSln(SLN_HEADER, path.resolve('/repo/App.sln'));
    assert.deepEqual(model.configurations, DEFAULT_CONFIGURATIONS);
  });

  it('combines .slnx build types and platforms, with SDK defaults for missing lists', async () => {
    const sample = await readSolution(path.join(FIXTURES, 'Sample.slnx'));
    assert.deepEqual(sample.configurations, DEFAULT_CONFIGURATIONS);
    const custom = parseSlnx(`<Solution>
  <Configurations>
    <BuildType Name="Debug" />
    <BuildType Name="Release" />
    <Platform Name="x64" />
    <Platform Name="ARM64" />
  </Configurations>
</Solution>`, path.resolve('/repo/App.slnx'));
    assert.deepEqual(custom.configurations.map(c => `${c.configuration}|${c.platform}`), ['Debug|x64', 'Debug|ARM64', 'Release|x64', 'Release|ARM64']);
  });

  it('resolves the active configuration: stored, then Debug|Any CPU, then first Debug, then first', () => {
    const list = [releaseX64, { configuration: 'Debug', platform: 'x64' }, debug];
    assert.deepEqual(resolveActiveConfiguration(list, 'release|X64'), releaseX64);
    assert.deepEqual(resolveActiveConfiguration(list, 'Gone|x64'), debug);
    assert.deepEqual(resolveActiveConfiguration(list.slice(0, 2)), { configuration: 'Debug', platform: 'x64' });
    assert.deepEqual(resolveActiveConfiguration([releaseX64]), releaseX64);
    assert.deepEqual(resolveActiveConfiguration([]), debug);
  });

  it('labels the status bar item without the platform unless it matters', () => {
    assert.equal(configurationLabel(debug, DEFAULT_CONFIGURATIONS), 'Debug');
    assert.equal(configurationLabel(releaseX64, [releaseX64]), 'Release | x64');
    assert.equal(configurationLabel(debug, [debug, releaseX64]), 'Debug | Any CPU');
  });

  it('parses and rejects configuration keys', () => {
    assert.deepEqual(parseConfigurationKey('Release|Any CPU'), { configuration: 'Release', platform: 'Any CPU' });
    for (const bad of ['Release', '|x64', 'Debug|', 'a|b|c', 'Debug|x64;rm -rf /', '-c|x64']) {
      assert.equal(parseConfigurationKey(bad), undefined, bad);
    }
  });

  it('persists the active configuration in the layout and validates it', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codestudio-config-'));
    const store = new JsonLayoutStore(path.join(dir, 'App.sln'));
    await store.save(setActiveConfiguration(EMPTY_LAYOUT, 'Release|Any CPU'));
    assert.equal((await store.load()).activeConfiguration, 'Release|Any CPU');
    assert.ok(!('activeConfiguration' in setActiveConfiguration(await store.load(), undefined)));
    assert.throws(() => setActiveConfiguration(EMPTY_LAYOUT, 'Release'), LayoutError);
    assert.throws(() => validateLayout({ version: 1, folders: [], activeConfiguration: 'nope' }, 'x'), /activeConfiguration/);
  });

  it('passes the configuration to build, clean, test, run and target-path queries, but not restore', () => {
    const sln = path.resolve('/repo/App.sln');
    const proj = path.resolve('/repo/src/App/App.csproj');
    assert.deepEqual(configurationArgs(undefined), []);
    assert.deepEqual(configurationArgs(debug), ['-c', 'Debug']);
    assert.deepEqual(configurationArgs(releaseX64), ['-c', 'Release', '-p:Platform=x64']);
    assert.deepEqual(targetVerbArgs('build', sln, releaseX64), ['build', sln, '-nologo', '-c', 'Release', '-p:Platform=x64']);
    assert.deepEqual(targetVerbArgs('clean', sln, debug), ['clean', sln, '-c', 'Debug']);
    assert.deepEqual(targetVerbArgs('test', proj, debug), ['test', proj, '-nologo', '-c', 'Debug']);
    assert.deepEqual(targetVerbArgs('restore', sln, releaseX64), ['restore', sln]);
    assert.deepEqual(runProjectArgs(proj, releaseX64), ['run', '--project', proj, '-c', 'Release', '-p:Platform=x64']);
    assert.deepEqual(targetPathArgs(proj, undefined, releaseX64).slice(-2), ['-p:Configuration=Release', '-p:Platform=x64']);
    assert.throws(() => configurationArgs({ configuration: '-p:Evil=1', platform: 'Any CPU' }), /not a valid build configuration/);
  });
});
