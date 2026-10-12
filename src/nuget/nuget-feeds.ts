import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { addNuGetSourceArgs, nugetSourceVerbArgs, updateNuGetSourceCredentialsArgs } from '../dotnet/dotnet-args';
import { DotnetRunner } from '../dotnet/dotnet-runner';
import { Logger } from '../logger';
import { NuGetClient } from './nuget-client';
import {
  isHttpSource, mergeNuGetConfigs, nugetConfigCandidates, PackageSource, parseNuGetConfig, ParsedNuGetConfig,
  userNuGetConfigPath, validateSourceName, validateSourceUrl,
} from './nuget-sources';

const SECRET_PREFIX = 'codestudio.nuget.credentials:';

/**
 * Package sources from the nuget.config chain (the same sources `dotnet restore` uses), feed clients
 * with credentials, and the Manage Package Sources UI (writes go through `dotnet nuget ... source`).
 */
export class NuGetFeeds {
  private readonly clients = new Map<string, NuGetClient>();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly runner: DotnetRunner,
    private readonly logger: Logger,
  ) {}

  /** All sources (enabled or not) that apply to <dir>, in priority order. */
  async sources(dir: string): Promise<PackageSource[]> {
    const configs: { file: string; config: ParsedNuGetConfig }[] = [];
    const seen = new Set<string>();
    for (const file of nugetConfigCandidates(dir, process.platform, process.env, os.homedir())) {
      // Case-insensitive file systems match several spellings of the same file.
      let real: string;
      try {
        real = await fs.realpath(file);
      } catch {
        continue;
      }
      const key = process.platform === 'linux' ? real : real.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        configs.push({ file: real, config: parseNuGetConfig(await fs.readFile(real, 'utf8'), process.env) });
      } catch (err) {
        this.logger.warn(`Could not read ${real}: ${(err as Error).message}`);
      }
    }
    return mergeNuGetConfigs(configs);
  }

  /** Enabled http(s) sources that can be browsed. */
  async browsable(dir: string): Promise<PackageSource[]> {
    return (await this.sources(dir)).filter(s => s.enabled && isHttpSource(s));
  }

  async client(source: PackageSource): Promise<NuGetClient> {
    let auth: string | undefined;
    if (source.password) auth = NuGetClient.basicAuth(source.username, source.password);
    else {
      const stored = await this.secrets.get(SECRET_PREFIX + source.url);
      if (stored) {
        const c = JSON.parse(stored) as { username?: string; password: string };
        auth = NuGetClient.basicAuth(c.username, c.password);
      }
    }
    const key = `${source.url}\n${auth ?? ''}`;
    let client = this.clients.get(key);
    if (!client) {
      client = new NuGetClient(source.url, undefined, undefined, auth);
      this.clients.set(key, client);
    }
    return client;
  }

  /**
   * Asks for a user name and personal access token for a feed that returned 401/403.
   * Returns true when credentials were stored.
   */
  async promptCredentials(source: PackageSource, cwd: string): Promise<boolean> {
    const username = await vscode.window.showInputBox({
      title: `Credentials for ${source.name}`,
      prompt: `User name for ${source.url} (any value works for Azure DevOps / GitHub tokens)`,
      value: source.username ?? '',
      ignoreFocusOut: true,
    });
    if (username === undefined) return false;
    const password = await vscode.window.showInputBox({
      title: `Credentials for ${source.name}`,
      prompt: 'Password or personal access token (needs package read access)',
      password: true,
      ignoreFocusOut: true,
      validateInput: v => (v ? undefined : 'Required'),
    });
    if (!password) return false;
    const where = await vscode.window.showQuickPick(
      [
        { label: 'Save in NuGet config', description: source.configFile ? path.basename(source.configFile) : 'user config', detail: 'Stored in clear text. Needed so dotnet restore / install can use the feed.', value: 'config' as const },
        { label: 'Use for browsing only', detail: 'Stored in VS Code secret storage. Restore needs a credential provider or config credentials.', value: 'secret' as const },
      ],
      { title: `Where should the credentials for ${source.name} be stored?`, ignoreFocusOut: true },
    );
    if (!where) return false;
    if (where.value === 'config') {
      await this.runner.exec(updateNuGetSourceCredentialsArgs(source.name, username, password, source.configFile), cwd);
    } else {
      await this.secrets.store(SECRET_PREFIX + source.url, JSON.stringify({ username, password }));
    }
    this.clients.clear();
    this.changed.fire();
    return true;
  }

  /** Visual Studio-style "Package Sources" options as QuickPicks. */
  async manage(dir: string): Promise<void> {
    for (;;) {
      const sources = await this.sources(dir);
      type Item = vscode.QuickPickItem & { source?: PackageSource; add?: true };
      const items: Item[] = [
        { label: '$(add) Add Package Source...', add: true },
        { label: 'Sources', kind: vscode.QuickPickItemKind.Separator },
        ...sources.map(s => ({
          label: `${s.enabled ? '$(check)' : '$(circle-slash)'} ${s.name}`,
          description: s.url,
          detail: `${s.enabled ? 'Enabled' : 'Disabled'} · ${s.configFile ?? 'default (no nuget.config found)'}${s.password ? ' · credentials in config' : ''}`,
          source: s,
        })),
      ];
      const pick = await vscode.window.showQuickPick(items, { title: 'NuGet Package Sources', placeHolder: 'Select a source to change it, or add one', matchOnDescription: true });
      if (!pick) return;
      if (pick.add) await this.add(dir);
      else if (pick.source) await this.edit(pick.source, dir);
    }
  }

  private async add(dir: string): Promise<void> {
    const url = await vscode.window.showInputBox({
      title: 'Add Package Source (1/3)',
      prompt: 'Feed URL (NuGet V3 index.json)',
      placeHolder: 'https://pkgs.dev.azure.com/<org>/_packaging/<feed>/nuget/v3/index.json',
      ignoreFocusOut: true,
      validateInput: v => validateSourceUrl(v),
    });
    if (!url) return;
    const name = await vscode.window.showInputBox({
      title: 'Add Package Source (2/3)',
      prompt: 'Source name',
      value: suggestName(url),
      ignoreFocusOut: true,
      validateInput: v => validateSourceName(v),
    });
    if (!name) return;
    const solutionConfig = path.join(dir, 'nuget.config');
    const target = await vscode.window.showQuickPick(
      [
        { label: 'This solution', description: solutionConfig, detail: 'Shared with everyone who clones the repository (recommended for organization feeds).', file: solutionConfig },
        { label: 'User (all solutions)', description: userNuGetConfigPath(process.platform, process.env, os.homedir()), file: undefined },
      ],
      { title: 'Add Package Source (3/3): save to which nuget.config?', ignoreFocusOut: true },
    );
    if (!target) return;
    if (target.file) await ensureConfigFile(target.file);
    await this.runner.exec(addNuGetSourceArgs(url.trim(), name.trim(), { configFile: target.file }), dir);
    this.changed.fire();
    const auth = await vscode.window.showInformationMessage(`CodeXStudio: Added package source "${name.trim()}". Does it need credentials?`, 'Add Credentials', 'No');
    if (auth === 'Add Credentials') {
      const source = (await this.sources(dir)).find(s => s.name === name.trim());
      if (source) await this.promptCredentials(source, dir);
    }
  }

  private async edit(source: PackageSource, dir: string): Promise<void> {
    const actions = [
      source.enabled ? 'Disable' : 'Enable',
      'Set Credentials...',
      ...(source.configFile ? ['Open nuget.config', 'Remove'] : []),
    ];
    const action = await vscode.window.showQuickPick(actions, { title: `${source.name} (${source.url})` });
    if (!action) return;
    if (action === 'Set Credentials...') {
      await this.promptCredentials(source, dir);
      return;
    }
    if (action === 'Open nuget.config') {
      await vscode.window.showTextDocument(vscode.Uri.file(source.configFile!));
      return;
    }
    if (action === 'Remove') {
      const ok = await vscode.window.showWarningMessage(`Remove package source "${source.name}" from ${source.configFile}?`, { modal: true }, 'Remove');
      if (ok !== 'Remove') return;
      await this.runner.exec(nugetSourceVerbArgs('remove', source.name, source.configFile), dir);
      await this.secrets.delete(SECRET_PREFIX + source.url);
    } else {
      await this.runner.exec(nugetSourceVerbArgs(source.enabled ? 'disable' : 'enable', source.name, source.configFile), dir);
    }
    this.clients.clear();
    this.changed.fire();
  }

  dispose(): void {
    this.changed.dispose();
  }
}

function suggestName(url: string): string {
  try {
    const u = new URL(url);
    const feed = /_packaging\/([^/]+)/.exec(u.pathname)?.[1];
    return (feed ?? u.hostname).replace(/[^A-Za-z0-9 _.()-]/g, '-').slice(0, 100);
  } catch {
    return 'MyFeed';
  }
}

async function ensureConfigFile(file: string): Promise<void> {
  try {
    await fs.access(file);
  } catch {
    // `dotnet nuget add source --configfile` requires the file to exist.
    await fs.writeFile(file, '<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n  <packageSources>\n  </packageSources>\n</configuration>\n', { flag: 'wx' });
  }
}
