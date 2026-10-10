// Pure naming-style checks and suggestions. No 'vscode' import.

export const NAMING_STYLES = ['PascalCase', 'camelCase', '_camelCase', 'm_camelCase', 's_camelCase', 'snake_case', 'UPPER_CASE'] as const;
export type NamingStyle = (typeof NAMING_STYLES)[number];

const PATTERNS: Record<NamingStyle, RegExp> = {
  PascalCase: /^[A-Z][A-Za-z0-9]*$/,
  camelCase: /^[a-z][A-Za-z0-9]*$/,
  _camelCase: /^_[a-z][A-Za-z0-9]*$/,
  m_camelCase: /^m_[a-z][A-Za-z0-9]*$/,
  s_camelCase: /^s_[a-z][A-Za-z0-9]*$/,
  snake_case: /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/,
  UPPER_CASE: /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/,
};

export interface NameRequirement {
  readonly style: NamingStyle;
  /** Extra prefix before the styled part, e.g. "I" for interfaces, "T" for type parameters. */
  readonly prefix?: string;
  /** Required suffix, e.g. "Async". */
  readonly suffix?: string;
}

export function describeRequirement(r: NameRequirement): string {
  const parts = [r.prefix ? `prefix "${r.prefix}"` : '', r.style, r.suffix ? `suffix "${r.suffix}"` : ''].filter(Boolean);
  return parts.join(' + ');
}

export function matchesRequirement(rawName: string, r: NameRequirement): boolean {
  let name = rawName.replace(/^@/, '');
  if (r.prefix) {
    if (!name.startsWith(r.prefix)) return false;
    name = name.slice(r.prefix.length);
    // "I" + PascalCase means the next letter must be upper case (IService, not Iservice).
    if (r.style === 'PascalCase' && name === '' ) return r.prefix === 'T'; // bare "T" type parameter is fine
  }
  if (r.suffix) {
    if (!name.endsWith(r.suffix) || name.length === r.suffix.length) return false;
    name = name.slice(0, -r.suffix.length);
  }
  return PATTERNS[r.style].test(name);
}

/** Splits an identifier into lower-case words: "_myHTTPValue2" -> ["my", "http", "value2"]. */
export function splitWords(rawName: string): string[] {
  const name = rawName.replace(/^@/, '').replace(/^(m_|s_|_+)/, '');
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_]+/)
    .filter(Boolean)
    .map(w => w.toLowerCase());
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

export function formatWords(words: string[], style: NamingStyle): string {
  if (words.length === 0) return '';
  const pascal = words.map(cap).join('');
  const camel = words[0] + words.slice(1).map(cap).join('');
  switch (style) {
    case 'PascalCase': return pascal;
    case 'camelCase': return camel;
    case '_camelCase': return `_${camel}`;
    case 'm_camelCase': return `m_${camel}`;
    case 's_camelCase': return `s_${camel}`;
    case 'snake_case': return words.join('_');
    case 'UPPER_CASE': return words.join('_').toUpperCase();
  }
}

/** Suggests a conforming name, or undefined if none can be derived. */
export function suggestName(rawName: string, r: NameRequirement): string | undefined {
  let words = splitWords(rawName);
  if (r.prefix && words.length > 1 && words[0] === r.prefix.toLowerCase()) words = words.slice(1);
  if (r.suffix && words.length > 1 && words[words.length - 1] === r.suffix.toLowerCase()) words = words.slice(0, -1);
  if (words.length === 0) return undefined;
  let result = formatWords(words, r.style);
  if (/^[0-9]/.test(result)) return undefined;
  if (r.prefix) result = r.prefix + (r.style === 'PascalCase' ? result : cap(result));
  if (r.suffix) result += r.suffix;
  return result !== rawName.replace(/^@/, '') && matchesRequirement(result, r) ? result : undefined;
}
