// Pure helpers for Solution Explorer file operations (rename, copy/paste, move). No 'vscode' import.
import * as path from 'path';

const INVALID_RE = /[\/\\:*?"<>|\x00-\x1f]/;
const RESERVED_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** Error message for an invalid file or folder name, or undefined when it is valid. */
export function validateEntryName(name: string): string | undefined {
  const t = name.trim();
  if (t === '') return 'Enter a name.';
  if (t === '.' || t === '..') return `"${t}" is not a valid name.`;
  if (INVALID_RE.test(t)) return 'Names cannot contain / \\ : * ? " < > | or control characters.';
  if (RESERVED_RE.test(t)) return `"${t}" is a reserved name on Windows.`;
  if (/[. ]$/.test(t)) return 'Names cannot end with a dot or a space.';
  if (t.length > 255) return 'Names are limited to 255 characters.';
  return undefined;
}

/** Visual Studio style copy name: "Foo - Copy.cs", then "Foo - Copy (2).cs", ... (folders keep no extension). */
export function copyName(name: string, isFolder: boolean, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  const ext = isFolder ? '' : path.extname(name);
  const stem = ext && ext !== name ? name.slice(0, -ext.length) : name;
  for (let i = 1; ; i++) {
    const candidate = `${stem} - Copy${i === 1 ? '' : ` (${i})`}${ext}`;
    if (!taken(candidate)) return candidate;
  }
}

/** True when `candidate` is `dir` itself or lies below it (a folder cannot be pasted or moved into itself). */
export function isSameOrInside(candidate: string, dir: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Range to preselect when renaming: the name without its extension ("Program" in "Program.cs"). */
export function stemSelection(name: string, isFolder: boolean): [number, number] {
  const ext = isFolder ? '' : path.extname(name);
  return [0, ext && ext !== name ? name.length - ext.length : name.length];
}
