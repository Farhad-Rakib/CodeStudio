import assert from 'node:assert/strict';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { unlistedProjects } from '../src/explorer/unlisted-projects';

describe('unlistedProjects', () => {
  const dir = path.resolve('/repo');
  const p = (...s: string[]) => path.join(dir, ...s);

  it('returns project files the solution does not list, sorted and de-duplicated', () => {
    const found = [p('src', 'Old', 'Old.csproj'), p('src', 'App', 'App.csproj'), p('lib', 'A.fsproj'), p('src', 'Old', 'Old.csproj')];
    assert.deepEqual(unlistedProjects(found, [p('src', 'App', 'App.csproj')], dir), [
      { absolutePath: p('lib', 'A.fsproj'), relativePath: 'lib/A.fsproj' },
      { absolutePath: p('src', 'Old', 'Old.csproj'), relativePath: 'src/Old/Old.csproj' },
    ]);
  });

  it('compares paths case-insensitively and after normalization', () => {
    assert.deepEqual(unlistedProjects([p('src', 'App', 'App.csproj')], [path.join(dir, 'src', '.', 'APP', 'app.csproj')], dir), []);
  });
});
