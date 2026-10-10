import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findIdentifierOccurrences, lintCSharpNaming, stripCode } from '../src/standards/csharp-naming-linter';
import { BEGIN_MARKER, END_MARKER, generateSection, isOnlyRootLine, removeSection, upsertSection } from '../src/standards/editorconfig';
import { matchesRequirement, splitWords, suggestName } from '../src/standards/naming';
import { CodingStandards, DEFAULT_STANDARDS, readStandards } from '../src/standards/standards-config';

const d = DEFAULT_STANDARDS;
const withNaming = (n: Partial<CodingStandards['naming']>): CodingStandards => ({ ...d, naming: { ...d.naming, ...n } });
const names = (src: string, s: CodingStandards = d) => lintCSharpNaming(src, s).map(v => `${v.kind}:${v.name}`);

describe('naming styles', () => {
  it('matches each style', () => {
    assert.ok(matchesRequirement('OrderService', { style: 'PascalCase' }));
    assert.ok(!matchesRequirement('orderService', { style: 'PascalCase' }));
    assert.ok(matchesRequirement('_count', { style: '_camelCase' }));
    assert.ok(!matchesRequirement('count', { style: '_camelCase' }));
    assert.ok(matchesRequirement('s_cache', { style: 's_camelCase' }));
    assert.ok(matchesRequirement('max_items', { style: 'snake_case' }));
    assert.ok(matchesRequirement('MAX_ITEMS', { style: 'UPPER_CASE' }));
    assert.ok(matchesRequirement('IRepository', { style: 'PascalCase', prefix: 'I' }));
    assert.ok(!matchesRequirement('Irepository', { style: 'PascalCase', prefix: 'I' }));
    assert.ok(matchesRequirement('T', { style: 'PascalCase', prefix: 'T' }));
    assert.ok(matchesRequirement('LoadAsync', { style: 'PascalCase', suffix: 'Async' }));
    assert.ok(!matchesRequirement('Async', { style: 'PascalCase', suffix: 'Async' }));
  });

  it('splits words and suggests conforming names', () => {
    assert.deepEqual(splitWords('_myHTTPValue2'), ['my', 'http', 'value2']);
    assert.equal(suggestName('order_service', { style: 'PascalCase' }), 'OrderService');
    assert.equal(suggestName('repository', { style: 'PascalCase', prefix: 'I' }), 'IRepository');
    assert.equal(suggestName('load_data', { style: 'PascalCase', suffix: 'Async' }), 'LoadDataAsync');
    assert.equal(suggestName('Count', { style: '_camelCase' }), '_count');
    assert.equal(suggestName('maxItems', { style: 'UPPER_CASE' }), 'MAX_ITEMS');
    assert.equal(suggestName('_', { style: 'camelCase' }), undefined);
  });
});

describe('settings model', () => {
  it('reads values and falls back to defaults for invalid ones', () => {
    const s = readStandards(k => ({ severity: 'error', 'naming.privateFields': 'm_camelCase', 'naming.methods': 'bogus', 'style.braces': 'yes' } as Record<string, unknown>)[k]);
    assert.equal(s.severity, 'error');
    assert.equal(s.naming.privateFields, 'm_camelCase');
    assert.equal(s.naming.methods, 'PascalCase');
    assert.equal(s.style.braces, true);
  });
});

describe('.editorconfig section', () => {
  it('generates naming rules, styles and code-style options at the chosen severity', () => {
    const text = generateSection({ ...d, severity: 'error' });
    assert.ok(text.startsWith(BEGIN_MARKER) && text.trimEnd().endsWith(END_MARKER));
    assert.match(text, /^\[\*\.cs\]$/m);
    assert.match(text, /dotnet_naming_rule\.dp_interfaces\.style = (\w+)/);
    assert.match(text, /required_prefix = I$/m);
    assert.match(text, /required_suffix = Async$/m);
    assert.match(text, /required_prefix = s_$/m);
    assert.match(text, /dotnet_naming_rule\.dp_private_fields\.severity = error/);
    assert.match(text, /csharp_style_namespace_declarations = file_scoped:error/);
    assert.match(text, /dotnet_diagnostic\.IDE1006\.severity = error/);
    // Every referenced style and symbol group is defined.
    for (const m of text.matchAll(/\.style = (\w+)/g)) assert.match(text, new RegExp(`dotnet_naming_style\\.${m[1]}\\.capitalization`));
    for (const m of text.matchAll(/\.symbols = (\w+)/g)) assert.match(text, new RegExp(`dotnet_naming_symbols\\.${m[1]}\\.applicable_kinds`));
  });

  it('maps snake_case and UPPER_CASE to word separators', () => {
    const text = generateSection(withNaming({ localsAndParameters: 'snake_case', constants: 'UPPER_CASE' }));
    assert.match(text, /capitalization = all_lower\n.*word_separator = _/);
    assert.match(text, /capitalization = all_upper\n.*word_separator = _/);
  });

  it('inserts into an empty file with root = true, preserves user content and replaces itself', () => {
    const first = upsertSection('', generateSection(d));
    assert.ok(first.startsWith('root = true\n\n' + BEGIN_MARKER));
    const user = 'root = true\n\n[*]\nindent_style = space\n';
    const merged = upsertSection(user, generateSection(d));
    assert.ok(merged.startsWith(user.trimEnd()));
    const again = upsertSection(merged, generateSection({ ...d, severity: 'error' }));
    assert.equal(again.split(BEGIN_MARKER).length, 2, 'only one managed section');
    assert.match(again, /severity = error/);
    assert.ok(again.includes('indent_style = space'));
  });

  it('moves an existing section to the end so its [*.cs] header cannot capture user rules', () => {
    const text = `${generateSection(d)}\n[*.json]\nindent_size = 2\n`;
    const result = upsertSection(text, generateSection(d));
    assert.ok(result.indexOf('[*.json]') < result.indexOf(BEGIN_MARKER));
  });

  it('removes the section and keeps CRLF line endings', () => {
    const user = 'root = true\r\n\r\n[*]\r\ncharset = utf-8\r\n';
    const merged = upsertSection(user, generateSection(d));
    assert.ok(!/[^\r]\n/.test(merged), 'CRLF preserved');
    assert.equal(removeSection(merged), 'root = true\r\n\r\n[*]\r\ncharset = utf-8\r\n');
    assert.ok(isOnlyRootLine(removeSection(upsertSection('', generateSection(d)))));
    assert.throws(() => removeSection(`${BEGIN_MARKER}\nfoo = bar\n`), /without/);
  });
});

describe('C# naming linter', () => {
  const sample = `using System;
namespace Demo;

/// <summary>Comment mentioning bad_name and class foo</summary>
public interface repository<tKey> { Task<Order> Get(tKey Id); }
public record order_line(string product_name, int Qty);
public class orderService : IDisposable
{
    private const int max_items = 10;
    private static int counter;
    private readonly string Name;
    public int total;
    public string customer_name { get; set; }
    public event EventHandler changed;
    public orderService(int Count) { Name = "var Bad = 1; // not code"; }
    public async Task<int> load_data(string FilePath, CancellationToken ct = default)
    {
        var Result = 0;
        for (int J = 0; J < 3; J++) { Result += J; }
        foreach (var Item in new[] { 1 }) { }
        if (int.TryParse(FilePath, out var Parsed)) { return Parsed; }
        try { } catch (Exception Ex) { }
        return Result;
    }
    public override string ToString() => base.ToString();
    public static async Task Main(string[] args) { }
    private async void OnClick(object sender, EventArgs e) { }
    public void Dispose() { }
}`;

  it('finds violations for every symbol kind', () => {
    assert.deepEqual(names(sample), [
      'interface:repository', 'typeParameter:tKey', 'parameter:Id', 'type:order_line', 'property:product_name', 'type:orderService',
      'constant:max_items', 'privateStaticField:counter', 'privateField:Name', 'publicField:total', 'property:customer_name',
      'property:changed', 'parameter:Count', 'asyncMethod:load_data', 'parameter:FilePath', 'local:Result', 'local:J', 'local:Item',
      'local:Parsed', 'local:Ex',
    ]);
  });

  it('reports nothing for conforming code, comments, strings, overrides, Main and async void handlers', () => {
    const ok = `namespace Demo;
public interface IRepository<TKey> { Task<int> GetAsync(TKey id); }
public sealed class OrderService(int seed) : IDisposable
{
    private const int MaxItems = 10;
    private static int s_counter;
    private readonly string _name = "BadName = 1; int Bad_Local = 2;";
    public string CustomerName { get; set; } = string.Empty;
    // var Bad = 0;
    /* private int Bad; */
    public async Task<int> LoadDataAsync(string filePath)
    {
        var result = seed;
        for (int i = 0; i < 3; i++) { result += i; }
        return await Task.FromResult(result + MaxItems + s_counter + _name.Length);
    }
    public override string ToString() => base.ToString();
    public static async Task Main(string[] args) { await Task.Yield(); }
    private async void OnClick(object sender, EventArgs e) { await Task.Yield(); }
    public void Dispose() { }
}`;
    assert.deepEqual(names(ok), []);
  });

  it('applies configured styles', () => {
    const src = 'class A { private int _count; void M() { var myValue = 1; } }';
    assert.deepEqual(names(src, withNaming({ privateFields: 'm_camelCase', localsAndParameters: 'snake_case' })), ['privateField:_count', 'local:myValue']);
    const v = lintCSharpNaming(src, withNaming({ privateFields: 'm_camelCase' }))[0];
    assert.equal(v.suggestion, 'm_count');
    assert.match(v.message, /Private field '_count' should be m_camelCase/);
  });

  it('handles top-level statements and verbatim/raw/interpolated strings', () => {
    const src = 'var App_Name = "x";\nvar s = $"{App_Name} \\"q\\"";\nvar raw = """\n  int Bad = 1;\n  """;\nvar v = @"C:\\x ""int Bad2 = 1;""";\n';
    assert.deepEqual(names(src), ['local:App_Name']);
    assert.equal(stripCode('a "b" c').length, 7);
  });

  it('provides rename ranges for file-local symbols only', () => {
    const src = 'class A { private int Count; public int total; void M(int Value) { var Result = Value + Count; } }';
    const byName = new Map(lintCSharpNaming(src, d).map(v => [v.name, v]));
    assert.ok(byName.get('Count')!.renameRange);
    assert.ok(byName.get('Value')!.renameRange);
    assert.ok(byName.get('Result')!.renameRange);
    assert.equal(byName.get('total')!.renameRange, undefined);
  });

  it('finds identifier occurrences outside comments, strings and other objects’ members', () => {
    const src = 'class A { private int Count; int M(A other) { /* Count */ var s = "Count"; return this.Count + Count + other.Count + CountX; } }';
    const hits = findIdentifierOccurrences(src, 'Count', { start: 0, end: src.length });
    assert.equal(hits.length, 3);
    for (const h of hits) assert.equal(src.slice(h, h + 5), 'Count');
  });
});
