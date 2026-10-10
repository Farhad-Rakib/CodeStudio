// Pure definition of CodeStudio's recommended settings and the change-planning logic.

export interface RecommendedSetting {
  readonly key: string;
  readonly value: unknown;
  /** Language override scope, e.g. 'csharp' for "[csharp]": { ... }. */
  readonly language?: string;
  readonly reason: string;
}

export const RECOMMENDED_SETTINGS: readonly RecommendedSetting[] = [
  { key: 'editor.tabSize', value: 4, language: 'csharp', reason: 'Four-space indentation for C#' },
  { key: 'editor.insertSpaces', value: true, language: 'csharp', reason: 'Indent C# with spaces' },
  { key: 'editor.formatOnSave', value: true, language: 'csharp', reason: 'Format C# files on save' },
  { key: 'files.trimTrailingWhitespace', value: true, language: 'csharp', reason: 'Trim trailing whitespace in C#' },
  { key: 'editor.defaultFormatter', value: 'codestudio.codestudio', language: 'csharp', reason: 'Use the CodeStudio formatter (dotnet format or CSharpier) for C#' },
  { key: 'editor.bracketPairColorization.enabled', value: true, reason: 'Bracket-pair colorization' },
  { key: 'editor.guides.bracketPairs', value: 'active', reason: 'Bracket-pair guide for the active block' },
  { key: 'editor.guides.highlightActiveIndentation', value: true, reason: 'Highlight the active indentation guide' },
  { key: 'editor.minimap.enabled', value: false, reason: 'Disable the minimap' },
  { key: 'editor.semanticHighlighting.enabled', value: true, reason: 'Semantic colors for types, members and variables' },
  { key: 'editor.codeLens', value: true, reason: 'Reference counts and test actions above members' },
  { key: 'editor.stickyScroll.enabled', value: true, reason: 'Keep the enclosing type/member visible while scrolling' },
  { key: 'editor.gotoLocation.multipleDefinitions', value: 'peek', reason: 'Peek when Go to Definition has several results' },
  { key: 'editor.renderLineHighlight', value: 'all', reason: 'Highlight the current line' },
  { key: 'problems.decorations.enabled', value: true, reason: 'Show diagnostics badges in explorers' },
  { key: 'problems.showCurrentInStatus', value: true, reason: 'Show the diagnostic at the cursor in the status bar' },
  { key: 'terminal.integrated.scrollback', value: 10000, reason: 'Keep long build output in the terminal' },
  { key: 'terminal.integrated.defaultLocation', value: 'view', reason: 'Open terminals in the bottom panel' },
  { key: 'workbench.colorTheme', value: 'CodeStudio Dark', reason: 'Use the CodeStudio Dark theme' },
];

export type SettingStatus = 'unset' | 'same' | 'different';

export interface PlannedSetting extends RecommendedSetting {
  readonly status: SettingStatus;
  readonly currentValue: unknown;
  /** Selected by default: only settings the user has not configured at the chosen scope. */
  readonly preselected: boolean;
}

export function displayKey(s: RecommendedSetting): string {
  return s.language ? `[${s.language}] ${s.key}` : s.key;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Compares recommendations with the values the user has explicitly set at the target scope.
 * `lookup` returns undefined when the user has not set the key there.
 */
export function planSettings(
  recommendations: readonly RecommendedSetting[],
  lookup: (s: RecommendedSetting) => unknown,
): PlannedSetting[] {
  return recommendations.map(rec => {
    const currentValue = lookup(rec);
    const status: SettingStatus = currentValue === undefined ? 'unset' : deepEqual(currentValue, rec.value) ? 'same' : 'different';
    return { ...rec, status, currentValue, preselected: status === 'unset' };
  });
}

/** Renders the selected changes as settings.json-style JSON for review. */
export function previewJson(changes: readonly RecommendedSetting[]): string {
  const out: Record<string, unknown> = {};
  for (const c of changes) {
    if (c.language) {
      const scope = `[${c.language}]`;
      out[scope] = { ...((out[scope] as Record<string, unknown>) ?? {}), [c.key]: c.value };
    } else {
      out[c.key] = c.value;
    }
  }
  return JSON.stringify(out, null, 2);
}
