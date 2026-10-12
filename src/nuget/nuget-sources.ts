// Pure NuGet package-source resolution from the nuget.config chain. No 'vscode' import.
import * as path from 'path';
import { NUGET_ORG_INDEX } from './nuget-client';

export interface PackageSource {
  readonly name: string;
  /** Feed URL (V3 index.json) or local folder path. */
  readonly url: string;
  readonly enabled: boolean;
  /** The nuget.config file that defines the source (undefined for the implicit nuget.org default). */
  readonly configFile?: string;
  readonly username?: string;
  /** Clear-text password or token (environment variables %VAR% already expanded). */
  readonly password?: string;
}

const CONFIG_NAMES = ['nuget.config', 'NuGet.config', 'NuGet.Config'];

/** Candidate nuget.config files, closest first: <dir> and every parent, then the user-level config. */
export function nugetConfigCandidates(startDir: string, platform: NodeJS.Platform, env: Record<string, string | undefined>, home: string): string[] {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const out: string[] = [];
  let dir = p.resolve(startDir);
  for (;;) {
    for (const n of CONFIG_NAMES) out.push(p.join(dir, n));
    const parent = p.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  out.push(userNuGetConfigPath(platform, env, home));
  return out;
}

export function userNuGetConfigPath(platform: NodeJS.Platform, env: Record<string, string | undefined>, home: string): string {
  if (platform === 'win32') return path.win32.join(env.APPDATA ?? path.win32.join(home, 'AppData', 'Roaming'), 'NuGet', 'NuGet.Config');
  return path.posix.join(home, '.nuget', 'NuGet', 'NuGet.Config');
}

function decodeXml(s: string): string {
  return s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (_m, e: string) => {
    const k = e.toLowerCase();
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    if (k === 'amp') return '&';
    return String.fromCodePoint(k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  });
}

function attrs(tag: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of tag.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) m.set(a[1].toLowerCase(), decodeXml(a[3] ?? a[4] ?? ''));
  return m;
}

function section(xml: string, name: string): string | undefined {
  const re = new RegExp(`<${name}(\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`, 'i');
  return re.exec(xml)?.[2];
}

/** One element per `<add .../>` or `<clear/>` in document order. */
function entries(body: string): ({ kind: 'clear' } | { kind: 'add'; key: string; value: string })[] {
  const out: ({ kind: 'clear' } | { kind: 'add'; key: string; value: string })[] = [];
  for (const t of body.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(add|clear)\b([^>]*)\/?>/gi)) {
    if (t[1].toLowerCase() === 'clear') out.push({ kind: 'clear' });
    else {
      const a = attrs(t[2]);
      const key = a.get('key');
      if (key !== undefined) out.push({ kind: 'add', key, value: a.get('value') ?? '' });
    }
  }
  return out;
}

export interface ParsedNuGetConfig {
  readonly sources: { key: string; value: string }[];
  readonly cleared: boolean;
  readonly disabled: Map<string, boolean>;
  readonly credentials: Map<string, { username?: string; password?: string }>;
}

export function parseNuGetConfig(xml: string, env: Record<string, string | undefined> = {}): ParsedNuGetConfig {
  const sources: { key: string; value: string }[] = [];
  let cleared = false;
  for (const e of entries(section(xml, 'packageSources') ?? '')) {
    if (e.kind === 'clear') {
      cleared = true;
      sources.length = 0;
    } else {
      const i = sources.findIndex(s => s.key.toLowerCase() === e.key.toLowerCase());
      if (i >= 0) sources.splice(i, 1);
      sources.push({ key: e.key, value: e.value });
    }
  }
  const disabled = new Map<string, boolean>();
  for (const e of entries(section(xml, 'disabledPackageSources') ?? '')) {
    if (e.kind === 'clear') disabled.clear();
    else disabled.set(e.key.toLowerCase(), e.value.trim().toLowerCase() === 'true');
  }
  const credentials = new Map<string, { username?: string; password?: string }>();
  const credBody = section(xml, 'packageSourceCredentials') ?? '';
  for (const c of credBody.matchAll(/<([\w.-]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/g)) {
    // Element names encode spaces as _x0020_ (XmlConvert).
    const name = c[1].replace(/_x([0-9a-f]{4})_/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
    const values = new Map<string, string>();
    for (const e of entries(c[2])) if (e.kind === 'add') values.set(e.key.toLowerCase(), e.value);
    const password = values.get('cleartextpassword');
    credentials.set(name.toLowerCase(), {
      username: values.get('username'),
      password: password === undefined ? undefined : expandEnv(password, env),
    });
  }
  return { sources, cleared, disabled, credentials };
}

function expandEnv(s: string, env: Record<string, string | undefined>): string {
  return s.replace(/%([^%]+)%/g, (m, name: string) => env[name] ?? m);
}

/**
 * Merges configs (closest first) the way NuGet does: farther configs are applied first, closer
 * ones override them, and `<clear/>` drops everything inherited from farther configs.
 * Without any configs, nuget.org is the implicit default source.
 */
export function mergeNuGetConfigs(configs: { file: string; config: ParsedNuGetConfig }[]): PackageSource[] {
  const sources = new Map<string, { name: string; url: string; file: string }>();
  const disabled = new Map<string, boolean>();
  const creds = new Map<string, { username?: string; password?: string }>();
  let sawAny = false;
  for (const { file, config } of [...configs].reverse()) {
    sawAny = true;
    if (config.cleared) sources.clear();
    for (const s of config.sources) {
      const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(s.value) || path.isAbsolute(s.value) ? s.value : path.resolve(path.dirname(file), s.value);
      sources.delete(s.key.toLowerCase());
      sources.set(s.key.toLowerCase(), { name: s.key, url, file });
    }
    for (const [k, v] of config.disabled) disabled.set(k, v);
    for (const [k, v] of config.credentials) creds.set(k, v);
  }
  if (!sawAny) return [{ name: 'nuget.org', url: NUGET_ORG_INDEX, enabled: true }];
  return [...sources.entries()].map(([key, s]) => ({
    name: s.name,
    url: s.url,
    enabled: !disabled.get(key),
    configFile: s.file,
    ...creds.get(key),
  }));
}

export function isHttpSource(s: PackageSource): boolean {
  return /^https?:\/\//i.test(s.url);
}

const SOURCE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.()-]{0,99}$/;

export function validateSourceName(name: string): string | undefined {
  return SOURCE_NAME_RE.test(name.trim()) ? undefined : 'Use letters, digits, spaces, ".", "_", "-" or parentheses.';
}

export function validateSourceUrl(url: string): string | undefined {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Enter an http(s) feed URL (for example https://pkgs.dev.azure.com/org/_packaging/feed/nuget/v3/index.json).';
    return undefined;
  } catch {
    return 'Enter a valid URL.';
  }
}
