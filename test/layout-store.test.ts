import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { buildStructure, filterStructure, StructureNode } from '../src/explorer/tree-builder';
import { readSolution } from '../src/solution/solution-reader';
import {
  assignProject,
  createFolder,
  deleteFolder,
  EMPTY_LAYOUT,
  folderPath,
  JsonLayoutStore,
  layoutPathFor,
  LayoutError,
  moveFolder,
  renameFolder,
  SolutionLayout,
  validateFolderName,
} from '../src/storage/layout-store';

const FIXTURES = path.resolve(__dirname, '../../test/fixtures');

describe('layout operations', () => {
  it('creates nested folders and rejects duplicate sibling names', () => {
    const a = createFolder(EMPTY_LAYOUT, 'Backend', undefined, 'a');
    const b = createFolder(a.layout, ' Services ', 'a', 'b');
    assert.equal(b.folder.name, 'Services');
    assert.equal(b.folder.parentId, 'a');
    assert.equal(folderPath(b.layout, 'b'), 'Backend / Services');
    assert.throws(() => createFolder(b.layout, 'backend'), LayoutError);
    // Same name under a different parent is fine.
    assert.doesNotThrow(() => createFolder(b.layout, 'Backend', 'a'));
    assert.throws(() => createFolder(b.layout, 'X', 'missing'), /does not exist/);
  });

  it('validates folder names', () => {
    assert.ok(validateFolderName(''));
    assert.ok(validateFolderName('a/b'));
    assert.ok(validateFolderName('..'));
    assert.ok(validateFolderName('x'.repeat(129)));
    assert.equal(validateFolderName('Shared Libraries'), undefined);
  });

  it('renames folders', () => {
    const { layout } = createFolder(EMPTY_LAYOUT, 'Old', undefined, 'a');
    assert.equal(renameFolder(layout, 'a', 'New').folders[0].name, 'New');
    assert.throws(() => renameFolder(layout, 'a', ''), LayoutError);
  });

  it('does not mutate the input layout', () => {
    const { layout } = createFolder(EMPTY_LAYOUT, 'A', undefined, 'a');
    const frozen = JSON.stringify(layout);
    assignProject(layout, 'p.csproj', 'a');
    renameFolder(layout, 'a', 'B');
    deleteFolder(layout, 'a');
    assert.equal(JSON.stringify(layout), frozen);
    assert.equal(EMPTY_LAYOUT.folders.length, 0);
  });

  it('deletes a folder with its sub-folders and releases their projects', () => {
    let l: SolutionLayout = createFolder(EMPTY_LAYOUT, 'A', undefined, 'a').layout;
    l = createFolder(l, 'B', 'a', 'b').layout;
    l = createFolder(l, 'C', undefined, 'c').layout;
    l = assignProject(l, 'x.csproj', 'b');
    l = assignProject(l, 'y.csproj', 'c');
    const after = deleteFolder(l, 'a');
    assert.deepEqual(after.folders.map(f => f.id), ['c']);
    assert.deepEqual(after.assignments, { 'y.csproj': 'c' });
  });

  it('moves folders and prevents cycles', () => {
    let l: SolutionLayout = createFolder(EMPTY_LAYOUT, 'A', undefined, 'a').layout;
    l = createFolder(l, 'B', 'a', 'b').layout;
    assert.throws(() => moveFolder(l, 'a', 'b'), /into itself/);
    assert.throws(() => moveFolder(l, 'a', 'a'), /into itself/);
    const moved = moveFolder(l, 'b', undefined);
    assert.equal(moved.folders.find(f => f.id === 'b')!.parentId, undefined);
  });

  it('assigns, moves and unassigns projects', () => {
    let l: SolutionLayout = createFolder(EMPTY_LAYOUT, 'A', undefined, 'a').layout;
    l = createFolder(l, 'B', undefined, 'b').layout;
    l = assignProject(l, 'src/Web/Web.csproj', 'a');
    l = assignProject(l, 'src/Web/Web.csproj', 'b');
    assert.deepEqual(l.assignments, { 'src/Web/Web.csproj': 'b' });
    l = assignProject(l, 'src/Web/Web.csproj', undefined);
    assert.deepEqual(l.assignments, {});
    assert.throws(() => assignProject(l, 'p', 'nope'), /does not exist/);
  });
});

describe('JsonLayoutStore', () => {
  let dir: string;
  let solution: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dotpilot-layout-'));
    solution = path.join(dir, 'App.sln');
    await fs.writeFile(solution, 'Microsoft Visual Studio Solution File, Format Version 12.00\n');
  });

  it('stores layout in .dotpilot/solution-layout.json beside the solution', () => {
    assert.equal(layoutPathFor(solution), path.join(dir, '.dotpilot', 'solution-layout.json'));
  });

  it('returns an empty layout when no file exists', async () => {
    assert.deepEqual(await new JsonLayoutStore(solution).load(), EMPTY_LAYOUT);
  });

  it('persists folders and assignments across store instances (restart)', async () => {
    let l: SolutionLayout = createFolder(EMPTY_LAYOUT, 'Backend', undefined, 'a').layout;
    l = createFolder(l, 'Services', 'a', 'b').layout;
    l = assignProject(l, 'src/Orders/Orders.csproj', 'b');
    await new JsonLayoutStore(solution).save(l);

    const reloaded = await new JsonLayoutStore(solution).load();
    assert.deepEqual(reloaded, l);
    const raw = JSON.parse(await fs.readFile(layoutPathFor(solution), 'utf8'));
    assert.equal(raw.version, 1);
    // No temp files are left behind.
    assert.deepEqual(await fs.readdir(path.join(dir, '.dotpilot')), ['solution-layout.json']);
  });

  it('never touches the solution file or project directories', async () => {
    const before = await fs.readFile(solution, 'utf8');
    const l = assignProject(createFolder(EMPTY_LAYOUT, 'A', undefined, 'a').layout, 'P/P.csproj', 'a');
    await new JsonLayoutStore(solution).save(l);
    assert.equal(await fs.readFile(solution, 'utf8'), before);
    assert.deepEqual((await fs.readdir(dir)).sort(), ['.dotpilot', 'App.sln']);
  });

  it('reports malformed files with actionable errors', async () => {
    const store = new JsonLayoutStore(solution);
    await fs.mkdir(path.dirname(store.location), { recursive: true });
    await fs.writeFile(store.location, '{ not json');
    await assert.rejects(store.load(), /is not valid JSON/);
    await fs.writeFile(store.location, JSON.stringify({ version: 2, folders: [] }));
    await assert.rejects(store.load(), /unsupported version/);
    await fs.writeFile(store.location, JSON.stringify({ version: 1, folders: [{ id: 'a', name: 'A', parentId: 'zzz' }] }));
    await assert.rejects(store.load(), /unknown parent/);
    await fs.writeFile(store.location, JSON.stringify({ version: 1, folders: [{ id: 'a', name: 'A', parentId: 'b' }, { id: 'b', name: 'B', parentId: 'a' }] }));
    await assert.rejects(store.load(), /cycle/);
  });

  it('drops assignments that reference deleted folders when loading', async () => {
    const store = new JsonLayoutStore(solution);
    await fs.mkdir(path.dirname(store.location), { recursive: true });
    await fs.writeFile(store.location, JSON.stringify({ version: 1, folders: [{ id: 'a', name: 'A' }], assignments: { 'x.csproj': 'a', 'y.csproj': 'gone' } }));
    assert.deepEqual((await store.load()).assignments, { 'x.csproj': 'a' });
  });
});

describe('buildStructure', () => {
  const labels = (nodes: StructureNode[]): unknown[] =>
    nodes.map(n => (n.kind === 'solutionFolder' || n.kind === 'virtualFolder' ? { [n.label]: labels(n.children) } : n.label));

  it('shows native solution folders when there is no layout', async () => {
    const model = await readSolution(path.join(FIXTURES, 'Sample.sln'));
    assert.deepEqual(labels(buildStructure(model, EMPTY_LAYOUT)), [
      { 'Solution Items': ['Directory.Build.props', 'README.md'] },
      { src: [{ Services: ['Orders'] }, 'Web'] },
      'Core',
      'Web.Tests',
    ]);
  });

  it('places assigned projects in virtual folders, overriding native placement', async () => {
    const model = await readSolution(path.join(FIXTURES, 'Sample.sln'));
    let l: SolutionLayout = createFolder(EMPTY_LAYOUT, 'Backend', undefined, 'a').layout;
    l = createFolder(l, 'Data', 'a', 'b').layout;
    l = assignProject(l, 'src/Services/Orders/Orders.csproj', 'b');
    l = assignProject(l, 'lib/Core/Core.fsproj', 'a');
    l = assignProject(l, 'no/longer/Exists.csproj', 'a');
    assert.deepEqual(labels(buildStructure(model, l)), [
      { Backend: [{ Data: ['Orders'] }, 'Core'] },
      { 'Solution Items': ['Directory.Build.props', 'README.md'] },
      { src: [{ Services: [] }, 'Web'] },
      'Web.Tests',
    ]);
  });

  it('gives every node a unique stable id', async () => {
    const model = await readSolution(path.join(FIXTURES, 'Sample.sln'));
    const l = assignProject(createFolder(EMPTY_LAYOUT, 'A', undefined, 'a').layout, 'lib/Core/Core.fsproj', 'a');
    const ids: string[] = [];
    const walk = (nodes: StructureNode[]) => nodes.forEach(n => { ids.push(n.id); if ('children' in n) walk(n.children); });
    walk(buildStructure(model, l));
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.includes('project:lib/Core/Core.fsproj'));
    assert.ok(ids.includes('vfolder:a'));
  });

  it('filters by name and keeps ancestors', async () => {
    const model = await readSolution(path.join(FIXTURES, 'Sample.sln'));
    const filtered = filterStructure(buildStructure(model, EMPTY_LAYOUT), 'ord');
    assert.deepEqual(labels(filtered), [{ src: [{ Services: ['Orders'] }] }]);
    assert.deepEqual(labels(filterStructure(buildStructure(model, EMPTY_LAYOUT), 'zzz')), []);
    assert.equal(filterStructure(buildStructure(model, EMPTY_LAYOUT), '  ').length, 4);
  });
});
