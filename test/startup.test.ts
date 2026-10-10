import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { runProjectArgs, targetPathArgs } from '../src/dotnet/dotnet-args';
import { isRunnable, isWebProject } from '../src/run/runnable';
import { ProjectInfo } from '../src/solution/project-reader';
import { EMPTY_LAYOUT, JsonLayoutStore, setStartupProject, validateLayout } from '../src/storage/layout-store';

const info = (p: Partial<ProjectInfo>): ProjectInfo => ({ targetFrameworks: ['net10.0'], packages: [], projectReferences: [], frameworkReferences: [], isTestProject: false, ...p });

describe('startup project', () => {
  it('persists, replaces and clears the startup project', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codestudio-startup-'));
    const store = new JsonLayoutStore(path.join(dir, 'App.sln'));
    let layout = setStartupProject(EMPTY_LAYOUT, 'src/App/App.csproj');
    await store.save(layout);
    assert.equal((await store.load()).startupProject, 'src/App/App.csproj');
    layout = setStartupProject(layout, 'src/Api/Api.csproj');
    assert.equal(layout.startupProject, 'src/Api/Api.csproj');
    layout = setStartupProject(layout, undefined);
    assert.ok(!('startupProject' in layout));
    await store.save(layout);
    assert.equal((await store.load()).startupProject, undefined);
  });

  it('validates the stored value', () => {
    assert.throws(() => validateLayout({ version: 1, folders: [], startupProject: 42 }, 'x'), /startupProject/);
    assert.equal(validateLayout({ version: 1, folders: [], startupProject: 'a.csproj' }, 'x').startupProject, 'a.csproj');
  });

  it('detects runnable projects', () => {
    assert.ok(isRunnable(info({ sdk: 'Microsoft.NET.Sdk', outputType: 'Exe' })));
    assert.ok(isRunnable(info({ sdk: 'Microsoft.NET.Sdk', outputType: 'WinExe' })));
    assert.ok(isRunnable(info({ sdk: 'Microsoft.NET.Sdk.Web' })));
    assert.ok(isRunnable(info({ sdk: 'Microsoft.NET.Sdk.Worker' })));
    assert.ok(!isRunnable(info({ sdk: 'Microsoft.NET.Sdk' })), 'class library');
    assert.ok(!isRunnable(info({ sdk: 'Microsoft.NET.Sdk.Razor' })), 'razor class library');
    assert.ok(!isRunnable(info({ sdk: 'Microsoft.NET.Sdk', outputType: 'Exe', isTestProject: true })), 'test project');
    assert.ok(isWebProject(info({ sdk: 'Microsoft.NET.Sdk.Web' })));
  });

  it('builds run and target-path arguments safely', () => {
    const proj = path.resolve('/repo/src/App/App.csproj');
    assert.deepEqual(runProjectArgs(proj), ['run', '--project', proj]);
    assert.deepEqual(targetPathArgs(proj), ['msbuild', proj, '-getProperty:TargetPath', '-nologo']);
    assert.deepEqual(targetPathArgs(proj, 'net10.0').slice(-1), ['-p:TargetFramework=net10.0']);
    assert.throws(() => targetPathArgs(proj, 'net10.0;rm -rf /'));
    assert.throws(() => runProjectArgs('App.csproj'));
  });
});
