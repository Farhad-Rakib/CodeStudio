import assert from 'node:assert/strict';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import {
  addPackageArgs,
  addProjectReferenceArgs,
  addProjectToSolutionArgs,
  DotnetArgumentError,
  removePackageArgs,
  targetVerbArgs,
  validatePackageId,
  validatePackageVersion,
} from '../src/dotnet/dotnet-args';
import { parseListSdks } from '../src/dotnet/sdk-detection';
import { planSettings, previewJson, RECOMMENDED_SETTINGS, RecommendedSetting } from '../src/settings/recommended-settings';

const root = path.resolve('/repo');
const sln = path.join(root, 'App.sln');
const web = path.join(root, 'src', 'Web', 'Web.csproj');
const core = path.join(root, 'src', 'Core', 'Core.csproj');

describe('dotnet argument construction', () => {
  it('builds solution and project verbs as argv arrays', () => {
    assert.deepEqual(targetVerbArgs('build', sln), ['build', sln, '-nologo']);
    assert.deepEqual(targetVerbArgs('restore', sln), ['restore', sln]);
    assert.deepEqual(targetVerbArgs('clean', path.join(root, 'App.slnx')), ['clean', path.join(root, 'App.slnx')]);
    assert.deepEqual(targetVerbArgs('test', web), ['test', web, '-nologo']);
  });

  it('keeps paths with spaces and shell metacharacters as single arguments', () => {
    const odd = path.join(root, 'My Apps; rm -rf ~', '$(whoami).csproj');
    assert.deepEqual(targetVerbArgs('build', odd), ['build', odd, '-nologo']);
  });

  it('rejects relative paths and unsupported file types', () => {
    assert.throws(() => targetVerbArgs('build', 'App.sln'), DotnetArgumentError);
    assert.throws(() => targetVerbArgs('build', path.join(root, 'evil.sh')), /not a supported project file/);
    assert.throws(() => addProjectToSolutionArgs(web, web), /not a .sln or .slnx/);
  });

  it('builds reference and solution membership commands', () => {
    assert.deepEqual(addProjectReferenceArgs(web, core), ['add', web, 'reference', core]);
    assert.throws(() => addProjectReferenceArgs(web, web), /cannot reference itself/);
    assert.deepEqual(addProjectToSolutionArgs(sln, core), ['sln', sln, 'add', core]);
  });

  it('validates package ids and versions', () => {
    assert.deepEqual(addPackageArgs(web, ' Serilog '), ['add', web, 'package', 'Serilog']);
    assert.deepEqual(addPackageArgs(web, 'Serilog', '4.0.0'), ['add', web, 'package', 'Serilog', '--version', '4.0.0']);
    assert.deepEqual(addPackageArgs(web, 'Serilog', '  '), ['add', web, 'package', 'Serilog']);
    assert.deepEqual(removePackageArgs(web, 'Serilog'), ['remove', web, 'package', 'Serilog']);
    assert.ok(validatePackageId('--source'));
    assert.ok(validatePackageId('a b'));
    assert.ok(validatePackageId(''));
    assert.equal(validatePackageId('Microsoft.Extensions.Logging'), undefined);
    assert.equal(validatePackageVersion('[8.0,9.0)'), undefined);
    assert.equal(validatePackageVersion('10.0.0-preview.1'), undefined);
    assert.ok(validatePackageVersion('--prerelease'));
    assert.ok(validatePackageVersion('1.0; echo'));
    assert.throws(() => addPackageArgs(web, 'Serilog', '-x'), DotnetArgumentError);
  });
});

describe('sdk detection', () => {
  it('parses `dotnet --list-sdks` output', () => {
    const out = '8.0.404 [/usr/local/share/dotnet/sdk]\n10.0.301 [/usr/local/share/dotnet/sdk]\n';
    assert.deepEqual(parseListSdks(out), [
      { version: '8.0.404', location: '/usr/local/share/dotnet/sdk' },
      { version: '10.0.301', location: '/usr/local/share/dotnet/sdk' },
    ]);
  });
});

describe('recommended settings', () => {
  const recs: RecommendedSetting[] = [
    { key: 'editor.minimap.enabled', value: false, reason: '' },
    { key: 'editor.tabSize', value: 4, language: 'csharp', reason: '' },
    { key: 'editor.formatOnSave', value: true, language: 'csharp', reason: '' },
  ];

  it('preselects only settings the user has not set, and never preselects user overrides', () => {
    const user: Record<string, unknown> = { 'editor.minimap.enabled': true, '[csharp]editor.tabSize': 4 };
    const plan = planSettings(recs, s => user[`${s.language ? `[${s.language}]` : ''}${s.key}`]);
    assert.deepEqual(plan.map(p => [p.key, p.status, p.preselected]), [
      ['editor.minimap.enabled', 'different', false],
      ['editor.tabSize', 'same', false],
      ['editor.formatOnSave', 'unset', true],
    ]);
  });

  it('renders a reviewable settings.json preview with language scopes', () => {
    assert.deepEqual(JSON.parse(previewJson(recs)), {
      'editor.minimap.enabled': false,
      '[csharp]': { 'editor.tabSize': 4, 'editor.formatOnSave': true },
    });
  });

  it('covers the documented defaults', () => {
    const keys = RECOMMENDED_SETTINGS.map(s => s.key);
    for (const k of ['editor.tabSize', 'editor.formatOnSave', 'editor.bracketPairColorization.enabled', 'editor.guides.highlightActiveIndentation', 'editor.minimap.enabled']) {
      assert.ok(keys.includes(k), k);
    }
  });
});
