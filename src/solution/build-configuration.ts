// Pure: solution build configurations (Debug/Release x platform). No 'vscode' import.

export interface BuildConfiguration {
  /** Configuration name, e.g. "Debug" or "Release". */
  readonly configuration: string;
  /** Solution platform, e.g. "Any CPU" or "x64". */
  readonly platform: string;
}

export const ANY_CPU = 'Any CPU';

/** What the SDK uses when a solution declares no configurations (.slnx files usually don't). */
export const DEFAULT_CONFIGURATIONS: readonly BuildConfiguration[] = Object.freeze([
  { configuration: 'Debug', platform: ANY_CPU },
  { configuration: 'Release', platform: ANY_CPU },
]);

const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9 _.-]{0,63}$/;

export function isValidConfigurationName(name: string): boolean {
  return NAME_RE.test(name) && name === name.trim();
}

/** "Debug|Any CPU": the form used in .sln files and stored in the CodeXStudio layout. */
export function configurationKey(c: BuildConfiguration): string {
  return `${c.configuration}|${c.platform}`;
}

export function parseConfigurationKey(key: string): BuildConfiguration | undefined {
  const bar = key.indexOf('|');
  if (bar <= 0 || bar !== key.lastIndexOf('|')) return undefined;
  const configuration = key.slice(0, bar).trim();
  const platform = key.slice(bar + 1).trim();
  if (!isValidConfigurationName(configuration) || !isValidConfigurationName(platform)) return undefined;
  return { configuration, platform };
}

/** Removes duplicates (case-insensitive, like MSBuild) and keeps the first spelling and order. */
export function uniqueConfigurations(list: readonly BuildConfiguration[]): BuildConfiguration[] {
  const seen = new Set<string>();
  const result: BuildConfiguration[] = [];
  for (const c of list) {
    const k = configurationKey(c).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    result.push(c);
  }
  return result;
}

/**
 * The configuration builds should use: the stored one if the solution still has it,
 * otherwise Debug|Any CPU, otherwise the first Debug, otherwise the first one.
 */
export function resolveActiveConfiguration(available: readonly BuildConfiguration[], storedKey?: string): BuildConfiguration {
  const list = available.length ? available : DEFAULT_CONFIGURATIONS;
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (storedKey) {
    const stored = list.find(c => eq(configurationKey(c), storedKey));
    if (stored) return stored;
  }
  return list.find(c => eq(c.configuration, 'Debug') && eq(c.platform, ANY_CPU))
    ?? list.find(c => eq(c.configuration, 'Debug'))
    ?? list[0];
}

/** Status bar text: "Debug", or "Release | x64" when the solution has more than one platform. */
export function configurationLabel(active: BuildConfiguration, available: readonly BuildConfiguration[]): string {
  const platforms = new Set(available.map(c => c.platform.toLowerCase()));
  return platforms.size > 1 || active.platform.toLowerCase() !== ANY_CPU.toLowerCase()
    ? `${active.configuration} | ${active.platform}`
    : active.configuration;
}
