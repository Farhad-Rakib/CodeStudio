import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { newProjectArgs } from '../src/dotnet/dotnet-args';
import { computeNamespace, ITEM_TEMPLATES, rankTemplates, toIdentifier, validateTypeName } from '../src/templates/item-templates';
import { parseTemplateList, suggestedParentFolder, validateProjectName, validateTemplateShortName } from '../src/templates/project-templates';

const FIXTURES = path.resolve(__dirname, '../../test/fixtures');

describe('project templates', () => {
  it('parses real `dotnet new list --type project` output', () => {
    const templates = parseTemplateList(readFileSync(path.join(FIXTURES, 'dotnet-new-list.txt'), 'utf8'));
    const byShort = new Map(templates.map(t => [t.shortName, t]));
    assert.ok(templates.length >= 10, `only ${templates.length} parsed`);
    assert.equal(byShort.get('webapi')?.name, 'ASP.NET Core Web API');
    assert.deepEqual(byShort.get('console')?.languages, ['C#', 'F#', 'VB']);
    // Multiple short names ("webapp,razor") use the first one.
    assert.ok(byShort.has('webapp') && !byShort.has('webapp,razor'));
    assert.match(byShort.get('xunit')!.tags, /Test/);
  });

  it('returns nothing for unparseable output instead of guessing', () => {
    assert.deepEqual(parseTemplateList('No templates found.'), []);
    assert.deepEqual(parseTemplateList(''), []);
  });

  it('validates names and suggests src/tests', () => {
    assert.equal(validateProjectName('Contoso.Orders.Api'), undefined);
    assert.ok(validateProjectName('My App'));
    assert.ok(validateProjectName('1Bad'));
    assert.ok(validateProjectName('../escape'));
    assert.match(validateProjectName('sample.core', ['Sample.Core'])!, /already/);
    assert.equal(validateTemplateShortName('webapi'), undefined);
    assert.ok(validateTemplateShortName('--install'));
    assert.equal(suggestedParentFolder({ name: 'x', shortName: 'xunit', languages: [], tags: 'Test/xUnit' }), 'tests');
    assert.equal(suggestedParentFolder({ name: 'x', shortName: 'webapi', languages: [], tags: 'Web/API' }), 'src');
  });

  it('builds dotnet new arguments safely', () => {
    const out = path.resolve('/repo/src/Api');
    assert.deepEqual(newProjectArgs('webapi', 'Contoso.Api', out), ['new', 'webapi', '-n', 'Contoso.Api', '-o', out]);
    assert.throws(() => newProjectArgs('--install', 'A', out));
    assert.throws(() => newProjectArgs('console', 'a b', out));
    assert.throws(() => newProjectArgs('console', 'A', 'relative/dir'));
  });
});

describe('item templates', () => {
  const proj = path.resolve('/repo/src/Contoso.Core/Contoso.Core.csproj');
  const dir = path.dirname(proj);

  it('computes namespaces from project name, RootNamespace and folders', () => {
    assert.equal(computeNamespace(proj, dir), 'Contoso.Core');
    assert.equal(computeNamespace(proj, path.join(dir, 'Models', 'Orders')), 'Contoso.Core.Models.Orders');
    assert.equal(computeNamespace(proj, path.join(dir, 'Models'), 'Acme.Domain'), 'Acme.Domain.Models');
    assert.equal(computeNamespace(proj, path.join(dir, 'my-folder', '2024')), 'Contoso.Core.my_folder._2024');
    assert.throws(() => computeNamespace(proj, path.resolve('/elsewhere')), /outside the project/);
  });

  it('escapes invalid identifiers and keywords', () => {
    assert.equal(toIdentifier('class'), '@class');
    assert.equal(toIdentifier('9lives'), '_9lives');
    assert.equal(toIdentifier('a b'), 'a_b');
  });

  it('validates type names', () => {
    assert.equal(validateTypeName('OrderService'), undefined);
    assert.equal(validateTypeName('OrderService.cs'), undefined);
    assert.ok(validateTypeName('class'));
    assert.ok(validateTypeName('Order Service'));
    assert.ok(validateTypeName('../x'));
  });

  it('renders every template with the namespace and type name', () => {
    assert.equal(new Set(ITEM_TEMPLATES.map(t => t.id)).size, ITEM_TEMPLATES.length);
    for (const t of ITEM_TEMPLATES) {
      const text = t.render({ namespace: 'Acme.Things', name: 'Widget' });
      assert.match(text, /namespace Acme\.Things;/, t.id);
      assert.match(text, /\bWidget\b/, t.id);
      assert.ok(validateTypeName(t.defaultName) === undefined, `${t.id} default name`);
    }
    assert.match(ITEM_TEMPLATES.find(t => t.id === 'api-controller')!.render({ namespace: 'A', name: 'OrdersController' }), /Route\("api\/orders"\)/);
  });

  it('ranks templates for the project type', () => {
    const xunit = rankTemplates({ packages: [{ id: 'xunit' }], isTestProject: true });
    assert.equal(xunit[0].id, 'xunit-test');
    const web = rankTemplates({ sdk: 'Microsoft.NET.Sdk.Web', packages: [], isTestProject: false });
    assert.deepEqual(web.slice(0, 2).map(t => t.id).sort(), ['api-controller', 'minimal-api']);
    assert.equal(rankTemplates({ packages: [], isTestProject: false })[0].id, 'class');
  });
});
