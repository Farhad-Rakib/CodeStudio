// Pure helpers for formatting a C# buffer in an isolated temp folder. No 'vscode' import.

export interface IndentFallback {
  readonly insertSpaces: boolean;
  readonly tabSize: number;
}

/** True when an .editorconfig declares `root = true` in its preamble (before any section). */
export function isRootEditorConfig(text: string): boolean {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) return false;
    if (/^root\s*=\s*true\s*$/i.test(line)) return true;
  }
  return false;
}

/**
 * Merges the .editorconfig files that apply to a file (outermost first) into one root file.
 * The editor's indentation options come first so any real configuration overrides them;
 * later sections win, matching EditorConfig's nearest-file-wins rule for `[*]`/`[*.cs]` sections.
 */
export function mergeEditorConfigs(outermostFirst: readonly string[], fallback: IndentFallback): string {
  const parts = [
    'root = true',
    '',
    '[*.cs]',
    `indent_style = ${fallback.insertSpaces ? 'space' : 'tab'}`,
    `indent_size = ${fallback.tabSize}`,
    `tab_width = ${fallback.tabSize}`,
  ];
  for (const text of outermostFirst) {
    const body = text.split(/\r?\n/).filter(l => !/^\s*root\s*=/i.test(l)).join('\n').trim();
    if (body) parts.push('', body);
  }
  return parts.join('\n') + '\n';
}
