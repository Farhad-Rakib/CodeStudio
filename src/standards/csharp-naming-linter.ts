// Lightweight, conservative C# naming checker. No 'vscode' import.
//
// This is not a C# parser. It blanks out comments/strings, classifies brace blocks
// (namespace / type / enum / code) and matches common declaration shapes in each scope.
// It favours missing a declaration over reporting a false positive; full analysis is
// provided by Roslyn through the generated .editorconfig when a C# extension is installed.
import { describeRequirement, matchesRequirement, NameRequirement, suggestName } from './naming';
import { CodingStandards, requirementFor, SYMBOL_LABELS, SymbolKind } from './standards-config';

export interface NamingViolation {
  readonly kind: SymbolKind;
  readonly name: string;
  /** Offset of the identifier (after any '@'). */
  readonly offset: number;
  readonly length: number;
  readonly requirement: NameRequirement;
  readonly suggestion?: string;
  readonly message: string;
  /** For file-local symbols: the text range where the identifier can be renamed safely. */
  readonly renameRange?: { readonly start: number; readonly end: number };
}

type BlockKind = 'namespace' | 'type' | 'enum' | 'code';
interface Block {
  readonly start: number;
  end: number;
  readonly kind: BlockKind;
  readonly parent?: Block;
  /** Declared type name for type blocks. */
  readonly typeName?: string;
  readonly typeKeyword?: string;
}

/** Replaces comments, string/char literals and preprocessor lines with spaces, preserving offsets and newlines. */
export function stripCode(text: string): string {
  const out = text.split('');
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  let i = 0;
  let lineStart = true;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (lineStart && /[ \t]/.test(c)) { i++; continue; }
    if (lineStart && c === '#') {
      const end = text.indexOf('\n', i);
      blank(i, end < 0 ? text.length : end);
      i = end < 0 ? text.length : end;
      continue;
    }
    lineStart = c === '\n';
    if (c === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      blank(i, end < 0 ? text.length : end);
      i = end < 0 ? text.length : end;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' && text.startsWith('"""', i)) {
      // Raw string literal: closed by the same number (>= 3) of quotes.
      let q = 0;
      while (text[i + q] === '"') q++;
      const end = text.indexOf('"'.repeat(q), i + q);
      const stop = end < 0 ? text.length : end + q;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || ((c === '@' || c === '$') && (next === '"' || ((next === '@' || next === '$') && text[i + 2] === '"')))) {
      const prefixLen = c === '"' ? 0 : next === '"' ? 1 : 2;
      const verbatim = text.slice(i, i + prefixLen).includes('@');
      let j = i + prefixLen + 1;
      while (j < text.length) {
        if (verbatim && text[j] === '"' && text[j + 1] === '"') { j += 2; continue; }
        if (!verbatim && text[j] === '\\') { j += 2; continue; }
        if (text[j] === '"') { j++; break; }
        if (!verbatim && text[j] === '\n') break;
        j++;
      }
      blank(i, j);
      i = j;
    } else if (c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== "'" && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      blank(i, j + 1);
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

const TYPE_HEADER_RE = /\b(class|struct|interface|record(?:\s+(?:class|struct))?)\s+(@?[A-Za-z_]\w*)/;

function buildBlocks(code: string): Block[] {
  const blocks: Block[] = [];
  const stack: Block[] = [];
  let boundary = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '{') {
      const header = code.slice(boundary, i);
      const parent = stack[stack.length - 1];
      let block: Block;
      const typeMatch = TYPE_HEADER_RE.exec(header);
      if (/\bnamespace\b/.test(header)) block = { start: i, end: code.length, kind: 'namespace', parent };
      else if (typeMatch && !/=>|\bnew\b/.test(header.slice(0, typeMatch.index))) {
        block = { start: i, end: code.length, kind: 'type', parent, typeName: typeMatch[2].replace(/^@/, ''), typeKeyword: typeMatch[1] };
      } else if (/\benum\s+@?[A-Za-z_]\w*/.test(header)) block = { start: i, end: code.length, kind: 'enum', parent };
      else block = { start: i, end: code.length, kind: 'code', parent };
      blocks.push(block);
      stack.push(block);
      boundary = i + 1;
    } else if (c === '}') {
      const b = stack.pop();
      if (b) b.end = i;
      boundary = i + 1;
    } else if (c === ';') {
      boundary = i + 1;
    }
  }
  return blocks;
}

function innermost(blocks: Block[], offset: number): Block | undefined {
  let best: Block | undefined;
  for (const b of blocks) if (b.start < offset && offset <= b.end && (!best || b.start > best.start)) best = b;
  return best;
}

const MODIFIERS = '(?:public|private|protected|internal|static|virtual|override|abstract|sealed|async|extern|unsafe|new|partial|readonly|const|volatile|required|fixed)';
const TYPE = '(?:[A-Za-z_][\\w.]*(?:\\s*<[^;{}()=]*?>)?(?:\\s*\\[\\s*,*\\s*\\])*\\??)';
const NAME = '(@?[A-Za-z_]\\w*)';
const MEMBER_START = '(?:^|(?<=[;{}\\]]))\\s*';

const METHOD_RE = new RegExp(`${MEMBER_START}((?:${MODIFIERS}\\s+)*)(${TYPE})\\s+${NAME}\\s*(?:<([^<>()]*)>)?\\s*\\(`, 'gm');
const FIELD_RE = new RegExp(`${MEMBER_START}((?:${MODIFIERS}\\s+)*)(${TYPE})\\s+${NAME}\\s*(?=[=;,\\[])`, 'gm');
const PROPERTY_RE = new RegExp(`${MEMBER_START}((?:${MODIFIERS}\\s+)*)(${TYPE})\\s+${NAME}\\s*(?=\\{|=>)`, 'gm');
const EVENT_RE = new RegExp(`${MEMBER_START}(?:${MODIFIERS}\\s+)*event\\s+${TYPE}\\s+${NAME}`, 'gm');
const TYPE_DECL_RE = /\b(class|struct|interface|enum|record(?:\s+(?:class|struct))?)\s+(@?[A-Za-z_]\w*)\s*(?:<([^<>]*)>)?\s*(\()?/g;
const DELEGATE_RE = new RegExp(`\\bdelegate\\s+${TYPE}\\s+${NAME}\\s*(?:<([^<>()]*)>)?\\s*\\(`, 'g');
const LOCAL_RE = new RegExp(`(?:^|(?<=[;{}(]))\\s*((?:(?:using|await\\s+using|const|ref|scoped|readonly)\\s+)*)(${TYPE})\\s+${NAME}\\s*(?==(?![=>])|;|\\bin\\b)`, 'gm');
const OUT_VAR_RE = new RegExp(`\\bout\\s+${TYPE}\\s+${NAME}\\s*(?=[,)])`, 'g');
const CATCH_RE = new RegExp(`\\bcatch\\s*\\(\\s*${TYPE}\\s+${NAME}\\s*\\)`, 'g');

const NOT_TYPES = new Set([
  'return', 'throw', 'await', 'yield', 'new', 'else', 'case', 'goto', 'is', 'as', 'in', 'out', 'ref', 'typeof', 'sizeof', 'nameof',
  'default', 'using', 'lock', 'if', 'while', 'for', 'foreach', 'switch', 'do', 'try', 'catch', 'finally', 'when', 'where', 'select',
  'from', 'let', 'orderby', 'group', 'into', 'join', 'on', 'equals', 'by', 'ascending', 'descending', 'event', 'delegate', 'class',
  'struct', 'interface', 'enum', 'record', 'namespace', 'operator', 'implicit', 'explicit', 'this', 'base', 'checked', 'unchecked',
  'fixed', 'unsafe', 'static', 'const', 'public', 'private', 'protected', 'internal', 'abstract', 'virtual', 'override', 'sealed',
  'readonly', 'async', 'extern', 'partial', 'volatile', 'required', 'global', 'not', 'and', 'or', 'with', 'stackalloc',
]);

/** Finds the matching close for an opening '(' / '{' in stripped code. */
function matchClose(code: string, open: number): number {
  const o = code[open];
  const cl = o === '(' ? ')' : o === '{' ? '}' : ']';
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === o) depth++;
    else if (code[i] === cl && --depth === 0) return i;
  }
  return code.length;
}

/** Splits a parameter list (without the parens) into parameters with the offset of each name. */
function parseParameters(code: string, open: number, close: number): { name: string; offset: number }[] {
  const result: { name: string; offset: number }[] = [];
  let depth = 0;
  let segStart = open + 1;
  const segments: [number, number][] = [];
  for (let i = open + 1; i < close; i++) {
    const c = code[i];
    if (c === '<' || c === '(' || c === '[' || c === '{') depth++;
    else if (c === '>' || c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { segments.push([segStart, i]); segStart = i + 1; }
  }
  segments.push([segStart, close]);
  for (const [s, e] of segments) {
    let seg = code.slice(s, e);
    const eq = seg.search(/=(?!>)/);
    const segEnd = eq >= 0 ? s + eq : e;
    seg = code.slice(s, segEnd).replace(/\[[^\]]*\]/g, m => ' '.repeat(m.length));
    const m = /(@?[A-Za-z_]\w*)\s*$/.exec(seg);
    if (!m) continue;
    const before = seg.slice(0, m.index).trim();
    if (before === '' || /^(this|params|ref|out|in|scoped)$/.test(before)) continue; // lambda-ish or malformed
    result.push({ name: m[1], offset: s + m.index });
  }
  return result;
}

function bodyRangeAfter(code: string, closeParen: number, blocks: Block[]): { start: number; end: number } | undefined {
  for (let i = closeParen + 1; i < code.length; i++) {
    const c = code[i];
    if (c === '{') {
      const b = blocks.find(x => x.start === i);
      return { start: closeParen, end: b ? b.end : matchClose(code, i) };
    }
    if (c === '=' && code[i + 1] === '>') {
      const semi = code.indexOf(';', i);
      return { start: closeParen, end: semi < 0 ? code.length : semi };
    }
    if (c === ';') return undefined; // abstract / interface / extern: no body
  }
  return undefined;
}

export function lintCSharpNaming(text: string, standards: CodingStandards): NamingViolation[] {
  const code = stripCode(text);
  const blocks = buildBlocks(code);
  const violations: NamingViolation[] = [];
  const seen = new Set<number>();

  const scopeAt = (offset: number): BlockKind | 'top' => innermost(blocks, offset)?.kind ?? 'top';
  const report = (kind: SymbolKind, rawName: string, offset: number, renameRange?: { start: number; end: number }) => {
    const name = rawName.replace(/^@/, '');
    const nameOffset = offset + (rawName.length - name.length);
    if (seen.has(nameOffset) || name === '_' || /^_+$/.test(name)) return;
    seen.add(nameOffset);
    const requirement = requirementFor(kind, standards);
    if (matchesRequirement(name, requirement)) return;
    const suggestion = suggestName(name, requirement);
    const message = `${SYMBOL_LABELS[kind]} '${name}' should be ${describeRequirement(requirement)}${suggestion ? ` (e.g. '${suggestion}')` : ''}.`;
    violations.push({ kind, name, offset: nameOffset, length: name.length, requirement, suggestion, message, renameRange });
  };
  const nameOffsetIn = (m: RegExpExecArray, group: number) => {
    const full = m[0];
    const idx = full.lastIndexOf(m[group]);
    return m.index + idx;
  };
  const reportParameters = (open: number, kind: SymbolKind = 'parameter') => {
    const close = matchClose(code, open);
    const body = bodyRangeAfter(code, close, blocks);
    for (const p of parseParameters(code, open, close)) {
      report(kind, p.name, p.offset, kind === 'parameter' && body ? { start: open, end: body.end } : undefined);
    }
  };
  const reportTypeParameters = (list: string | undefined, listOffset: number) => {
    if (!list) return;
    let pos = 0;
    for (const part of list.split(',')) {
      const m = /(?:\b(?:in|out)\s+)?(@?[A-Za-z_]\w*)\s*$/.exec(part.replace(/\[[^\]]*\]/g, ''));
      if (m) report('typeParameter', m[1], listOffset + pos + part.lastIndexOf(m[1]));
      pos += part.length + 1;
    }
  };

  // Types, type parameters and primary-constructor parameters.
  for (const m of code.matchAll(TYPE_DECL_RE)) {
    if (scopeAt(m.index!) === 'code') continue;
    const keyword = m[1];
    report(keyword === 'interface' ? 'interface' : 'type', m[2], m.index! + m[0].indexOf(m[2], keyword.length));
    if (m[3] !== undefined) reportTypeParameters(m[3], m.index! + m[0].indexOf('<') + 1);
    if (m[4]) reportParameters(m.index! + m[0].length - 1, keyword.startsWith('record') ? 'property' : 'parameter');
  }
  for (const m of code.matchAll(DELEGATE_RE)) {
    if (scopeAt(m.index!) === 'code') continue;
    report('type', m[1], nameOffsetIn(m, 1));
    reportParameters(m.index! + m[0].length - 1);
  }

  // Members of classes/structs/records/interfaces.
  for (const m of code.matchAll(METHOD_RE)) {
    const block = innermost(blocks, m.index! + m[0].length - 1);
    if (block?.kind !== 'type') continue;
    const [, mods, type, name, typeParams] = m;
    if (NOT_TYPES.has(type) || /\boperator\b/.test(type)) continue;
    const open = m.index! + m[0].length - 1;
    if (!/\boverride\b|\bextern\b/.test(mods)) {
      const isAsync = /\basync\b/.test(mods) && !/^void$/.test(type) && name !== 'Main';
      report(isAsync ? 'asyncMethod' : 'method', name, nameOffsetIn(m, 3));
    }
    if (typeParams !== undefined) reportTypeParameters(typeParams, m.index! + m[0].lastIndexOf('<', m[0].length - 1) + 1);
    if (!/\boverride\b/.test(mods)) reportParameters(open);
  }
  // Constructors: `[modifiers] TypeName(`.
  for (const block of blocks.filter(b => b.kind === 'type' && b.typeName)) {
    const ctorRe = new RegExp(`${MEMBER_START}(?:${MODIFIERS}\\s+)*${block.typeName}\\s*\\(`, 'gm');
    ctorRe.lastIndex = block.start + 1;
    for (let m = ctorRe.exec(code); m && m.index < block.end; m = ctorRe.exec(code)) {
      if (innermost(blocks, m.index + m[0].length - 1) === block) reportParameters(m.index + m[0].length - 1);
    }
  }
  for (const m of code.matchAll(PROPERTY_RE)) {
    if (innermost(blocks, m.index! + m[0].length)?.kind !== 'type' || NOT_TYPES.has(m[2])) continue;
    if (/\boverride\b/.test(m[1])) continue;
    report('property', m[3], nameOffsetIn(m, 3));
  }
  for (const m of code.matchAll(EVENT_RE)) {
    if (innermost(blocks, m.index! + m[0].length)?.kind !== 'type') continue;
    report('property', m[1], nameOffsetIn(m, 1));
  }
  for (const m of code.matchAll(FIELD_RE)) {
    if (innermost(blocks, m.index! + m[0].length)?.kind !== 'type' || NOT_TYPES.has(m[2])) continue;
    const mods = m[1];
    const isPrivate = !/\b(public|protected|internal)\b/.test(mods);
    const kind: SymbolKind = /\bconst\b/.test(mods) ? 'constant'
      : isPrivate && /\bstatic\b/.test(mods) ? 'privateStaticField'
        : isPrivate ? 'privateField' : 'publicField';
    report(kind, m[3], nameOffsetIn(m, 3), isPrivate ? { start: 0, end: code.length } : undefined);
  }

  // Locals (method bodies, accessors, lambdas and top-level statements).
  const localScope = (offset: number): { start: number; end: number } => {
    let b = innermost(blocks, offset);
    if (!b) return { start: offset, end: code.length };
    while (b.parent && b.parent.kind === 'code') b = b.parent;
    return { start: offset, end: b.end };
  };
  const inCode = (offset: number) => {
    const s = scopeAt(offset);
    return s === 'code' || s === 'top';
  };
  for (const m of code.matchAll(LOCAL_RE)) {
    const nameOffset = nameOffsetIn(m, 3);
    if (!inCode(nameOffset) || NOT_TYPES.has(m[2])) continue;
    report(/\bconst\b/.test(m[1]) ? 'constant' : 'local', m[3], nameOffset, localScope(nameOffset));
  }
  for (const re of [OUT_VAR_RE, CATCH_RE]) {
    for (const m of code.matchAll(re)) {
      const nameOffset = nameOffsetIn(m, 1);
      if (inCode(nameOffset)) report('local', m[1], nameOffset, localScope(nameOffset));
    }
  }

  return violations.sort((a, b) => a.offset - b.offset);
}

/** Offsets of whole-word occurrences of `name` in code (comments/strings excluded) within a range. */
export function findIdentifierOccurrences(text: string, name: string, range: { start: number; end: number }): number[] {
  const code = stripCode(text);
  const re = new RegExp(`(?<![\\w@])@?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w)`, 'g');
  const result: number[] = [];
  re.lastIndex = range.start;
  for (let m = re.exec(code); m && m.index <= range.end; m = re.exec(code)) {
    // Skip member accesses on other objects (x.name) except this./base.
    const before = code.slice(Math.max(0, m.index - 6), m.index);
    if (before.endsWith('.') && !/(this|base)\s*\.$/.test(before)) continue;
    result.push(m.index + (m[0].startsWith('@') ? 1 : 0));
  }
  return result;
}
