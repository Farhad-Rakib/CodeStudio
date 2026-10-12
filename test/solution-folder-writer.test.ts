import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { addProjectToSolutionFolderArgs, DotnetArgumentError } from '../src/dotnet/dotnet-args';
import { addSolutionFolder, addSolutionItem, removeSolutionFolder, removeSolutionItem, renameSolutionFolder, solutionFolderPath, validateSolutionFolderName } from '../src/solution/solution-folder-writer';
import { parseSln, parseSlnx } from '../src/solution/solution-reader';

const FIXTURES = path.resolve(__dirname, '../../test/fixtures');
const GUID = 'abcdef01-2345-6789-abcd-ef0123456789';
const SLN_HEADER = 'Microsoft Visual Studio Solution File, Format Version 12.00\n';

describe('addSolutionFolder (.sln)', () => {
  it('adds a root folder and a nested folder that parse back', async () => {
    const sln = path.join(FIXTURES, 'Sample.sln');
    const text = await fs.readFile(sln, 'utf8');
    const model = parseSln(text, sln);

    const root = addSolutionFolder('sln', text, model, ' Docs ', undefined, GUID);
    const rootModel = parseSln(root, sln);
    const docs = rootModel.folders.find(f => f.name === 'Docs');
    assert.equal(docs?.id, GUID.toUpperCase());
    assert.equal(docs?.parentFolderId, undefined);
    assert.equal(rootModel.projects.length, model.projects.length);

    const nested = addSolutionFolder('sln', text, model, 'Api', '22222222-2222-2222-2222-222222222222', GUID);
    const nestedModel = parseSln(nested, sln);
    assert.equal(nestedModel.folders.find(f => f.name === 'Api')?.parentFolderId, '22222222-2222-2222-2222-222222222222');
    assert.equal(solutionFolderPath(nestedModel, GUID.toUpperCase()), 'src/Services/Api');
    // Existing lines are kept verbatim: only insertions.
    for (const line of text.split(/\r?\n/)) assert.ok(nested.includes(line));
  });

  it('creates a NestedProjects section when missing and keeps CRLF', () => {
    const text = (SLN_HEADER + 'Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "src", "src", "{11111111-1111-1111-1111-111111111111}"\nEndProject\nGlobal\nEndGlobal\n').replace(/\n/g, '\r\n');
    const model = parseSln(text, '/x/A.sln');
    const out = addSolutionFolder('sln', text, model, 'inner', '11111111-1111-1111-1111-111111111111', GUID);
    assert.ok(!/[^\r]\n/.test(out));
    assert.equal(parseSln(out, '/x/A.sln').folders.find(f => f.name === 'inner')?.parentFolderId, '11111111-1111-1111-1111-111111111111');
  });

  it('rejects duplicates and invalid names', async () => {
    const sln = path.join(FIXTURES, 'Sample.sln');
    const model = parseSln(await fs.readFile(sln, 'utf8'), sln);
    assert.match(validateSolutionFolderName(model, 'SRC', undefined) ?? '', /already exists/);
    assert.equal(validateSolutionFolderName(model, 'src', '11111111-1111-1111-1111-111111111111'), undefined);
    assert.ok(validateSolutionFolderName(model, 'a/b', undefined));
    assert.ok(validateSolutionFolderName(model, 'a"b', undefined));
    assert.ok(validateSolutionFolderName(model, '  ', undefined));
  });
});

describe('addSolutionFolder (.slnx)', () => {
  it('adds root and nested folders that parse back', async () => {
    const slnx = path.join(FIXTURES, 'Sample.slnx');
    const text = await fs.readFile(slnx, 'utf8');
    const model = parseSlnx(text, slnx);
    const out = addSolutionFolder('slnx', text, model, 'R&D', '/src/Services/', GUID);
    const parsed = parseSlnx(out, slnx);
    const f = parsed.folders.find(x => x.name === 'R&D');
    assert.equal(f?.id, '/src/Services/R&D/');
    assert.equal(f?.parentFolderId, '/src/Services/');
    assert.ok(out.includes('  <Folder Name="/src/Services/R&amp;D/" />\n</Solution>'));
    assert.equal(parsed.projects.length, model.projects.length);
    assert.equal(parseSlnx(addSolutionFolder('slnx', text, model, 'Docs', undefined, GUID), slnx).folders.find(x => x.name === 'Docs')?.id, '/Docs/');
  });
});

describe('addProjectToSolutionFolderArgs', () => {
  it('builds --solution-folder / --in-root and validates the path', () => {
    assert.deepEqual(addProjectToSolutionFolderArgs('/s/A.sln', '/s/p/P.csproj', 'src/Api'),
      ['sln', '/s/A.sln', 'add', '/s/p/P.csproj', '--solution-folder', 'src/Api']);
    assert.deepEqual(addProjectToSolutionFolderArgs('/s/A.slnx', '/s/p/P.csproj', undefined),
      ['sln', '/s/A.slnx', 'add', '/s/p/P.csproj', '--in-root']);
    assert.throws(() => addProjectToSolutionFolderArgs('/s/A.sln', '/s/p/P.csproj', '-x'), DotnetArgumentError);
    assert.throws(() => addProjectToSolutionFolderArgs('/s/A.sln', '/s/p/P.csproj', 'a//b'), DotnetArgumentError);
  });
});

describe('addSolutionItem', () => {
  it('.sln: appends to an existing SolutionItems section or creates one', async () => {
    const sln = path.join(FIXTURES, 'Sample.sln');
    const text = await fs.readFile(sln, 'utf8');
    const model = parseSln(text, sln);
    const existing = parseSln(addSolutionItem('sln', text, model, '33333333-3333-3333-3333-333333333333', 'docs/Notes.md'), sln);
    assert.deepEqual(existing.folders.find(f => f.name === 'Solution Items')?.files.map(f => path.relative(path.dirname(sln), f)),
      ['README.md', 'Directory.Build.props', path.join('docs', 'Notes.md')]);
    const created = addSolutionItem('sln', text, model, '11111111-1111-1111-1111-111111111111', 'src/IGreeter.cs');
    assert.ok(created.replace(/\r\n/g, '\n').includes('\tProjectSection(SolutionItems) = preProject\n\t\tsrc\\IGreeter.cs = src\\IGreeter.cs\n\tEndProjectSection\nEndProject'));
    assert.equal(parseSln(created, sln).folders.find(f => f.name === 'src')?.files.length, 1);
    assert.throws(() => addSolutionItem('sln', text, model, '11111111-1111-1111-1111-111111111111', '../x.cs'));
  });

  it('.slnx: expands a self-closing folder and appends to an open one', async () => {
    const slnx = path.join(FIXTURES, 'Sample.slnx');
    const text = await fs.readFile(slnx, 'utf8');
    let model = parseSlnx(text, slnx);
    let out = addSolutionFolder('slnx', text, model, 'Docs', undefined, GUID);
    model = parseSlnx(out, slnx);
    out = addSolutionItem('slnx', out, model, '/Docs/', 'Docs/A & B.md');
    assert.ok(out.includes('  <Folder Name="/Docs/">\n    <File Path="Docs/A &amp; B.md" />\n  </Folder>'));
    out = addSolutionItem('slnx', out, parseSlnx(out, slnx), '/src/', 'src/Readme.md');
    const parsed = parseSlnx(out, slnx);
    assert.equal(parsed.folders.find(f => f.id === '/Docs/')?.files[0], path.join(path.dirname(slnx), 'Docs', 'A & B.md'));
    assert.equal(parsed.folders.find(f => f.id === '/src/')?.files.length, 1);
    assert.equal(parsed.projects.length, model.projects.length);
  });
});

describe('removeSolutionFolder / renameSolutionFolder', () => {
  it('.sln: removes a folder with sub-folders, items and nesting lines once its projects are gone', async () => {
    const sln = path.join(FIXTURES, 'Sample.sln');
    const text = await fs.readFile(sln, 'utf8');
    const model = parseSln(text, sln);
    assert.throws(() => removeSolutionFolder('sln', text, model, '11111111-1111-1111-1111-111111111111'), /Web, Orders/);
    const withoutProjects = { ...model, projects: model.projects.filter(p => !p.parentFolderId) };
    const out = removeSolutionFolder('sln', text, withoutProjects, '11111111-1111-1111-1111-111111111111');
    assert.ok(!/11111111|22222222/.test(out));
    const items = removeSolutionFolder('sln', text, model, '33333333-3333-3333-3333-333333333333');
    const parsed = parseSln(items, sln);
    assert.deepEqual(parsed.folders.map(f => f.name), ['src', 'Services']);
    assert.ok(!items.includes('README.md'));
    assert.equal(parsed.projects.length, model.projects.length);
  });

  it('.sln: drops an emptied NestedProjects section and renames a folder', () => {
    const text = SLN_HEADER + [
      'Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "a", "a", "{11111111-1111-1111-1111-111111111111}"', 'EndProject',
      'Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "b", "b", "{22222222-2222-2222-2222-222222222222}"', 'EndProject',
      'Global', '\tGlobalSection(NestedProjects) = preSolution', '\t\t{22222222-2222-2222-2222-222222222222} = {11111111-1111-1111-1111-111111111111}', '\tEndGlobalSection', 'EndGlobal', ''].join('\n');
    const model = parseSln(text, '/x/A.sln');
    const out = removeSolutionFolder('sln', text, model, '22222222-2222-2222-2222-222222222222');
    assert.ok(!out.includes('NestedProjects'));
    assert.ok(out.includes('Global\nEndGlobal'));
    const renamed = renameSolutionFolder('sln', text, model, '11111111-1111-1111-1111-111111111111', 'Apps');
    assert.ok(renamed.includes('= "Apps", "Apps", "{11111111-1111-1111-1111-111111111111}"'));
    assert.throws(() => renameSolutionFolder('sln', text, model, '22222222-2222-2222-2222-222222222222', 'b/c'));
  });

  it('.slnx: removes a folder tree and renames paths of sub-folders', async () => {
    const slnx = path.join(FIXTURES, 'Sample.slnx');
    const text = await fs.readFile(slnx, 'utf8');
    const model = parseSlnx(text, slnx);
    const rest = { ...model, projects: model.projects.filter(p => !p.parentFolderId?.startsWith('/src/')) };
    const out = removeSolutionFolder('slnx', text, rest, '/src/').replace(/<Project Path="src[^]*?(\/>|<\/Project>)/g, '');
    assert.ok(!out.includes('/src/'));
    assert.ok(out.includes('  <Folder Name="/tests/unit/">'));
    const renamed = parseSlnx(renameSolutionFolder('slnx', text, model, '/src/', 'source'), slnx);
    assert.deepEqual(renamed.folders.map(f => f.id).sort(), ['/Solution Items/', '/source/', '/source/Services/', '/tests/', '/tests/unit/']);
    assert.equal(renamed.projects.find(p => p.name === 'Orders')?.parentFolderId, '/source/Services/');
  });
});

describe('removeSolutionItem', () => {
  it('.sln: removes one entry and drops an emptied section', async () => {
    const sln = path.join(FIXTURES, 'Sample.sln');
    const text = await fs.readFile(sln, 'utf8');
    const model = parseSln(text, sln);
    const id = '33333333-3333-3333-3333-333333333333';
    const one = removeSolutionItem('sln', text, model, id, 'readme.md'); // case-insensitive match
    assert.deepEqual(parseSln(one, sln).folders.find(f => f.id === id)?.files.map(f => path.basename(f)), ['Directory.Build.props']);
    const none = removeSolutionItem('sln', one, parseSln(one, sln), id, 'Directory.Build.props');
    assert.ok(!none.includes('SolutionItems'));
    assert.ok(none.includes('"Solution Items", "Solution Items", "{33333333-3333-3333-3333-333333333333}"\r\nEndProject'));
    assert.throws(() => removeSolutionItem('sln', text, model, id, 'missing.txt'), /not listed/);
    // Move = remove + add, also for a path outside the solution directory.
    const moved = addSolutionItem('sln', one, parseSln(one, sln), '11111111-1111-1111-1111-111111111111', '../shared/README.md', true);
    assert.equal(parseSln(moved, sln).folders.find(f => f.name === 'src')?.files.length, 1);
    assert.throws(() => addSolutionItem('sln', one, model, id, '../x.md'));
  });

  it('.slnx: removes a <File> element', async () => {
    const slnx = path.join(FIXTURES, 'Sample.slnx');
    const text = await fs.readFile(slnx, 'utf8');
    const model = parseSlnx(text, slnx);
    const out = removeSolutionItem('slnx', text, model, '/Solution Items/', 'README.md');
    assert.ok(out.includes('  <Folder Name="/Solution Items/">\n  </Folder>'));
    assert.equal(parseSlnx(out, slnx).folders.find(f => f.id === '/Solution Items/')?.files.length, 0);
  });
});
