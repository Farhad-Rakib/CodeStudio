// Pure generation and merging of CodeXStudio's managed .editorconfig section. No 'vscode' import.
import { NamingStyle } from './naming';
import { CodingStandards, SymbolKind, requirementFor } from './standards-config';

export const BEGIN_MARKER = '# BEGIN CodeXStudio coding standards';
export const END_MARKER = '# END CodeXStudio coding standards';
const MARKER_PAIRS: readonly [string, string][] = [[BEGIN_MARKER, END_MARKER]];

function capitalization(style: NamingStyle): { capitalization: string; prefix?: string; separator?: string } {
  switch (style) {
    case 'PascalCase': return { capitalization: 'pascal_case' };
    case 'camelCase': return { capitalization: 'camel_case' };
    case '_camelCase': return { capitalization: 'camel_case', prefix: '_' };
    case 'm_camelCase': return { capitalization: 'camel_case', prefix: 'm_' };
    case 's_camelCase': return { capitalization: 'camel_case', prefix: 's_' };
    case 'snake_case': return { capitalization: 'all_lower', separator: '_' };
    case 'UPPER_CASE': return { capitalization: 'all_upper', separator: '_' };
  }
}

interface SymbolSpec {
  readonly kind: SymbolKind;
  readonly id: string;
  readonly kinds: string;
  readonly accessibilities?: string;
  readonly modifiers?: string;
}

// Most specific first (Roslyn also orders by specificity, but explicit order keeps intent readable).
const SYMBOLS: readonly SymbolSpec[] = [
  { kind: 'constant', id: 'constants', kinds: 'field, local', modifiers: 'const' },
  { kind: 'privateStaticField', id: 'private_static_fields', kinds: 'field', accessibilities: 'private', modifiers: 'static' },
  { kind: 'privateField', id: 'private_fields', kinds: 'field', accessibilities: 'private' },
  { kind: 'publicField', id: 'non_private_fields', kinds: 'field', accessibilities: 'public, internal, protected, protected_internal, private_protected' },
  { kind: 'interface', id: 'interfaces', kinds: 'interface' },
  { kind: 'typeParameter', id: 'type_parameters', kinds: 'type_parameter' },
  { kind: 'type', id: 'types', kinds: 'class, struct, enum, delegate' },
  { kind: 'asyncMethod', id: 'async_methods', kinds: 'method', modifiers: 'async' },
  { kind: 'method', id: 'methods', kinds: 'method, local_function' },
  { kind: 'property', id: 'properties_and_events', kinds: 'property, event' },
  { kind: 'parameter', id: 'parameters_and_locals', kinds: 'parameter, local' },
];

/** Builds the managed section text (including markers), ending with a newline. */
export function generateSection(s: CodingStandards): string {
  const sev = s.severity;
  const lines: string[] = [
    BEGIN_MARKER,
    '# Generated from Settings > Extensions > CodeXStudio > Coding Standards.',
    '# Edits inside this block are overwritten; put your own rules outside it.',
    '[*.cs]',
    '',
    '# Code style',
    `csharp_style_namespace_declarations = ${s.style.fileScopedNamespaces ? 'file_scoped' : 'block_scoped'}:${sev}`,
    `csharp_prefer_braces = ${s.style.braces ? 'true' : 'when_multiline'}:${sev}`,
    `csharp_using_directive_placement = ${s.style.usingsOutsideNamespace ? 'outside_namespace' : 'inside_namespace'}:${sev}`,
    `dotnet_style_predefined_type_for_locals_parameters_members = ${s.style.predefinedTypes}:${sev}`,
    `dotnet_style_predefined_type_for_member_access = ${s.style.predefinedTypes}:${sev}`,
  ];
  const varAll = s.style.var === 'always';
  const varApparent = s.style.var !== 'never';
  lines.push(
    `csharp_style_var_for_built_in_types = ${varAll}:${sev}`,
    `csharp_style_var_when_type_is_apparent = ${varApparent}:${sev}`,
    `csharp_style_var_elsewhere = ${varAll}:${sev}`,
    '',
    '# Naming rules (IDE1006)',
  );

  const styleIds = new Map<string, string[]>();
  for (const spec of SYMBOLS) {
    const req = requirementFor(spec.kind, s);
    const cap = capitalization(req.style);
    const prefix = (req.prefix ?? '') + (cap.prefix ?? '');
    const styleId = ['dp', cap.capitalization, prefix && `prefix_${prefix.replace(/_/g, 'u')}`, req.suffix && `suffix_${req.suffix}`, cap.separator && 'sep']
      .filter(Boolean).join('_').toLowerCase();
    if (!styleIds.has(styleId)) {
      const styleLines = [`dotnet_naming_style.${styleId}.capitalization = ${cap.capitalization}`];
      if (prefix) styleLines.push(`dotnet_naming_style.${styleId}.required_prefix = ${prefix}`);
      if (req.suffix) styleLines.push(`dotnet_naming_style.${styleId}.required_suffix = ${req.suffix}`);
      if (cap.separator) styleLines.push(`dotnet_naming_style.${styleId}.word_separator = ${cap.separator}`);
      styleIds.set(styleId, styleLines);
    }
    const sym = `dp_${spec.id}`;
    lines.push(`dotnet_naming_symbols.${sym}.applicable_kinds = ${spec.kinds}`);
    lines.push(`dotnet_naming_symbols.${sym}.applicable_accessibilities = ${spec.accessibilities ?? '*'}`);
    if (spec.modifiers) lines.push(`dotnet_naming_symbols.${sym}.required_modifiers = ${spec.modifiers}`);
    lines.push(`dotnet_naming_rule.dp_${spec.id}.symbols = ${sym}`);
    lines.push(`dotnet_naming_rule.dp_${spec.id}.style = ${styleId}`);
    lines.push(`dotnet_naming_rule.dp_${spec.id}.severity = ${sev}`);
    lines.push('');
  }
  for (const styleLines of styleIds.values()) lines.push(...styleLines, '');
  lines.push(`dotnet_diagnostic.IDE1006.severity = ${sev}`, END_MARKER);
  return lines.join('\n') + '\n';
}

function findSection(text: string): { start: number; end: number } | undefined {
  for (const [begin, endMarkerText] of MARKER_PAIRS) {
    const start = text.indexOf(begin);
    if (start < 0) continue;
    const endMarker = text.indexOf(endMarkerText, start);
    if (endMarker < 0) throw new Error(`.editorconfig contains "${begin}" without "${endMarkerText}"; fix the file manually.`);
    let end = endMarker + endMarkerText.length;
    if (text[end] === '\r') end++;
    if (text[end] === '\n') end++;
    return { start, end };
  }
  return undefined;
}

/**
 * Inserts or replaces the managed section. It is always placed at the end of the file so the
 * `[*.cs]` header inside it cannot capture properties the user wrote after it.
 */
export function upsertSection(existing: string, section: string): string {
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  let rest = existing;
  // Remove every managed block (current and legacy markers) before appending the fresh one.
  for (let found = findSection(rest); found; found = findSection(rest)) rest = rest.slice(0, found.start) + rest.slice(found.end);
  rest = rest.replace(/\s+$/, '');
  const body = section.replace(/\n/g, eol);
  if (rest === '') return `root = true${eol}${eol}${body}`;
  return `${rest}${eol}${eol}${body}`;
}

/** Removes the managed section; returns the remaining text (possibly empty). */
export function removeSection(existing: string): string {
  const found = findSection(existing);
  if (!found) return existing;
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const rest = (existing.slice(0, found.start) + existing.slice(found.end)).replace(/\s+$/, '');
  return rest === '' ? '' : rest + eol;
}

/** True when nothing but `root = true` remains (the line CodeXStudio adds to a file it creates). */
export function isOnlyRootLine(text: string): boolean {
  return /^root\s*=\s*true$/i.test(text.trim());
}

export function hasSection(text: string): boolean {
  return MARKER_PAIRS.some(([begin]) => text.includes(begin));
}
