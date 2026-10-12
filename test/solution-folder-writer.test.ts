import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { addProjectToSolutionFolderArgs, DotnetArgumentError } from '../src/dotnet/dotnet-args';
import { addSolutionFolder, solutionFolderPath, validateSolutionFolderName } from '../src/solution/solution-folder-writer';
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
