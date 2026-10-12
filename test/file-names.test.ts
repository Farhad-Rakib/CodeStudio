import assert from 'node:assert/strict';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { copyName, isSameOrInside, stemSelection, validateEntryName } from '../src/explorer/file-names';

describe('file names', () => {
  it('validates file and folder names', () => {
    assert.equal(validateEntryName('Program.cs'), undefined);
    assert.equal(validateEntryName('.editorconfig'), undefined);
    for (const bad of ['', '  ', '.', '..', 'a/b', 'a\\b', 'a:b', 'what?', 'CON', 'nul.txt', 'trailing.']) {
      assert.ok(validateEntryName(bad), bad);
    }
  });

  it('builds Visual Studio style copy names', () => {
    const taken = new Set(['program.cs', 'program - copy.cs', 'models']);
    const isTaken = (n: string) => taken.has(n.toLowerCase());
    assert.equal(copyName('New.cs', false, isTaken), 'New.cs');
    assert.equal(copyName('Program.cs', false, isTaken), 'Program - Copy (2).cs');
    assert.equal(copyName('Models', true, isTaken), 'Models - Copy');
    assert.equal(copyName('.editorconfig', false, n => n === '.editorconfig'), '.editorconfig - Copy');
  });

  it('detects a folder pasted into itself', () => {
    const root = path.resolve('/w/App');
    assert.ok(isSameOrInside(root, root));
    assert.ok(isSameOrInside(path.join(root, 'Models', 'Sub'), root));
    assert.ok(!isSameOrInside(path.resolve('/w/App2'), root));
    assert.ok(!isSameOrInside(path.resolve('/w'), root));
  });

  it('preselects the name without its extension', () => {
    assert.deepEqual(stemSelection('Program.cs', false), [0, 7]);
    assert.deepEqual(stemSelection('My.Folder', true), [0, 9]);
    assert.deepEqual(stemSelection('.gitignore', false), [0, 10]);
  });
});
