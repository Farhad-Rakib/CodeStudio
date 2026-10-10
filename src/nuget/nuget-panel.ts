import { randomBytes } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { addPackageArgs, removePackageArgs, validatePackageId, validatePackageVersion } from '../dotnet/dotnet-args';
import { DotnetRunner } from '../dotnet/dotnet-runner';
import { Logger } from '../logger';
import { SolutionManager } from '../solution-manager';
import { SolutionProject } from '../solution/solution-model';
import { NuGetClient } from './nuget-client';
import { buildRows, PackageRow, PackageSummary, sortVersionsDescending } from './nuget-model';
import { renderNuGetHtml } from './nuget-webview-html';

/** Messages the webview sends to the extension. */
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'search'; query: string }
  | { type: 'setPrerelease'; value: boolean }
  | { type: 'select'; id: string }
  | { type: 'install'; id: string; version?: string }
  | { type: 'uninstall'; id: string }
  | { type: 'updateAll' }
  | { type: 'refresh' }
  | { type: 'switchProject'; key: string }
  | { type: 'openUrl'; url: string };

/** Messages the extension posts to the webview. */
export type PanelMessage =
  | { type: 'project'; project: { key: string; name: string }; projects: { key: string; name: string }[]; prerelease: boolean }
  | { type: 'installed'; rows: PackageRow[] }
  | { type: 'results'; query: string; total: number; items: (PackageSummary & { installedVersion?: string })[] }
  | { type: 'details'; pkg: PackageSummary; versions: string[]; installedVersion?: string; central: boolean }
  | { type: 'busy'; text?: string }
  | { type: 'notice'; level: 'info' | 'error'; text: string };

/**
 * Visual Studio-style NuGet Package Manager for one project: Browse (nuget.org search),
 * Installed and Updates tabs with install / uninstall / update through the dotnet CLI.
 */
export class NuGetPanel implements vscode.Disposable {
  private static readonly panels = new Map<string, NuGetPanel>();
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private prerelease = false;
  private rows: PackageRow[] = [];
  private readonly summaries = new Map<string, PackageSummary>();
  private busy = false;
  private disposed = false;
  /** Every message posted to the webview (inspected by integration tests). */
  readonly posted: PanelMessage[] = [];

  static open(deps: NuGetDeps, project: SolutionProject): NuGetPanel {
    const existing = NuGetPanel.panels.get(project.key);
    if (existing) {
      existing.panel.reveal();
      return existing;
    }
    const panel = new NuGetPanel(deps, project);
    NuGetPanel.panels.set(project.key, panel);
    return panel;
  }

  static get(projectKey: string): NuGetPanel | undefined {
    return NuGetPanel.panels.get(projectKey);
  }

  private constructor(private readonly deps: NuGetDeps, private project: SolutionProject) {
    this.panel = vscode.window.createWebviewPanel('codestudio.nuget', this.title(), vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    });
    const nonce = randomBytes(16).toString('base64');
    this.panel.webview.html = renderNuGetHtml(this.panel.webview.cspSource, nonce);
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage(m => void this.handleMessage(m as WebviewMessage)),
      this.panel.onDidDispose(() => this.dispose()),
      deps.manager.onDidChange(() => {
        // The project may have been removed or its packages edited outside the panel.
        const still = deps.manager.solution?.model.projects.find(p => p.key === this.project.key);
        if (!still) this.panel.dispose();
        else if (!this.busy) void this.refreshInstalled();
      }),
    );
  }

  private title(): string {
    return `NuGet: ${this.project.name}`;
  }

  get projectKey(): string {
    return this.project.key;
  }

  private post(message: PanelMessage): void {
    // Async work (searches, refreshes) can finish after the user closed the panel.
    if (this.disposed) return;
    this.posted.push(message);
    this.panel.webview.postMessage(message).then(undefined, () => undefined);
  }

  /**
   * Handles a webview message. Public so tests can drive the panel without a browser.
   * Every branch awaits so failures are caught below and shown in the panel.
   */
  async handleMessage(m: WebviewMessage): Promise<void> {
    try {
      switch (m.type) {
        case 'ready':
          this.postProject();
          await this.refreshInstalled();
          return await this.search('');
        case 'refresh':
          this.summaries.clear();
          await this.refreshInstalled();
          return;
        case 'search':
          return await this.search(String(m.query ?? '').slice(0, 200));
        case 'setPrerelease':
          this.prerelease = m.value === true;
          this.rows = buildRows(this.rows, this.summaries, this.prerelease);
          this.post({ type: 'installed', rows: this.rows });
          return;
        case 'select':
          return await this.select(m.id);
        case 'install':
          return await this.install(m.id, m.version);
        case 'uninstall':
          return await this.uninstall(m.id);
        case 'updateAll':
          return await this.updateAll();
        case 'switchProject':
          return await this.switchProject(m.key);
        case 'openUrl':
          if (typeof m.url === 'string' && /^https:\/\//i.test(m.url)) await vscode.env.openExternal(vscode.Uri.parse(m.url));
          return;
      }
    } catch (err) {
      this.deps.logger.error('NuGet panel action failed', err);
      this.post({ type: 'notice', level: 'error', text: (err as Error).message });
    }
  }

  private postProject(): void {
    const projects = (this.deps.manager.solution?.model.projects ?? [])
      .filter(p => p.kind === 'csharp' || p.kind === 'fsharp' || p.kind === 'vb')
      .map(p => ({ key: p.key, name: p.name }));
    this.post({ type: 'project', project: { key: this.project.key, name: this.project.name }, projects, prerelease: this.prerelease });
  }

  private async summary(id: string): Promise<PackageSummary | undefined> {
    const key = id.toLowerCase();
    if (!this.summaries.has(key)) {
      const pkg = await this.deps.client.getPackage(id, true);
      if (pkg) this.summaries.set(key, pkg);
    }
    return this.summaries.get(key);
  }

  async refreshInstalled(): Promise<void> {
    const info = await this.deps.manager.projectInfo(this.project.absolutePath);
    const installed = info.packages.map(p => ({ id: p.id, version: p.version }));
    // Show the installed list immediately, then enrich it with feed metadata.
    this.rows = buildRows(installed, this.summaries, this.prerelease);
    this.post({ type: 'installed', rows: this.rows });
    const missing = installed.filter(p => !this.summaries.has(p.id.toLowerCase()));
    for (let i = 0; i < missing.length; i += 6) {
      await Promise.all(missing.slice(i, i + 6).map(p => this.summary(p.id).catch(err => this.deps.logger.warn(`NuGet lookup failed for ${p.id}: ${(err as Error).message}`))));
    }
    this.rows = buildRows(installed, this.summaries, this.prerelease);
    this.post({ type: 'installed', rows: this.rows });
  }

  private installedVersion(id: string): string | undefined {
    return this.rows.find(r => r.id.toLowerCase() === id.toLowerCase())?.version;
  }

  private async search(query: string): Promise<void> {
    this.post({ type: 'busy', text: 'Searching nuget.org...' });
    try {
      const { total, items } = await this.deps.client.search(query, { take: 30, prerelease: this.prerelease });
      for (const item of items) this.summaries.set(item.id.toLowerCase(), item);
      this.post({ type: 'results', query, total, items: items.map(i => ({ ...i, installedVersion: this.installedVersion(i.id) })) });
    } finally {
      this.post({ type: 'busy' });
    }
  }

  private async select(id: string): Promise<void> {
    if (validatePackageId(id)) return;
    const pkg = await this.summary(id);
    if (!pkg) throw new Error(`Package ${id} was not found on the feed.`);
    const row = this.rows.find(r => r.id.toLowerCase() === id.toLowerCase());
    const versions = sortVersionsDescending(pkg.versions.length ? pkg.versions : [pkg.version], this.prerelease || !!row?.version?.includes('-'));
    this.post({ type: 'details', pkg, versions, installedVersion: row?.version, central: !!row && row.version === undefined });
  }

  private async runCli(text: string, args: string[]): Promise<void> {
    this.busy = true;
    this.post({ type: 'busy', text });
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: text }, () =>
        this.deps.runner.exec(args, path.dirname(this.project.absolutePath), 300000));
      await this.deps.manager.reload();
    } finally {
      this.busy = false;
      this.post({ type: 'busy' });
    }
  }

  private async install(id: string, version?: string): Promise<void> {
    const idError = validatePackageId(id);
    if (idError) throw new Error(idError);
    const v = version?.trim() || undefined;
    if (v && validatePackageVersion(v)) throw new Error(validatePackageVersion(v));
    const current = this.installedVersion(id);
    const verb = current ? (v ? `Updating ${id} to ${v}` : `Updating ${id}`) : `Installing ${id}${v ? ` ${v}` : ''}`;
    await this.runCli(`${verb} in ${this.project.name}...`, addPackageArgs(this.project.absolutePath, id, v));
    await this.refreshInstalled();
    this.post({ type: 'notice', level: 'info', text: `${current ? 'Updated' : 'Installed'} ${id}${v ? ` ${v}` : ''}.` });
    await this.select(id);
  }

  private async uninstall(id: string): Promise<void> {
    const idError = validatePackageId(id);
    if (idError) throw new Error(idError);
    if (!this.installedVersion(id) && !this.rows.some(r => r.id.toLowerCase() === id.toLowerCase())) {
      throw new Error(`${id} is not installed in ${this.project.name}.`);
    }
    const confirm = await vscode.window.showWarningMessage(`Uninstall ${id} from ${this.project.name}?`, { modal: true }, 'Uninstall');
    if (confirm !== 'Uninstall') return;
    await this.runCli(`Uninstalling ${id} from ${this.project.name}...`, removePackageArgs(this.project.absolutePath, id));
    await this.refreshInstalled();
    this.post({ type: 'notice', level: 'info', text: `Uninstalled ${id}.` });
    await this.select(id).catch(() => undefined);
  }

  private async updateAll(): Promise<void> {
    const updates = this.rows.filter(r => r.updateAvailable && r.latest);
    if (updates.length === 0) {
      this.post({ type: 'notice', level: 'info', text: 'All packages are up to date.' });
      return;
    }
    const confirm = await vscode.window.showInformationMessage(
      `Update ${updates.length} package(s) in ${this.project.name}?`,
      { modal: true, detail: updates.map(u => `${u.id}: ${u.version} → ${u.latest}`).join('\n') },
      'Update',
    );
    if (confirm !== 'Update') return;
    for (const u of updates) {
      await this.runCli(`Updating ${u.id} to ${u.latest}...`, addPackageArgs(this.project.absolutePath, u.id, u.latest));
    }
    await this.refreshInstalled();
    this.post({ type: 'notice', level: 'info', text: `Updated ${updates.length} package(s).` });
  }

  private async switchProject(key: string): Promise<void> {
    const target = this.deps.manager.solution?.model.projects.find(p => p.key === key);
    if (!target || target.key === this.project.key) return;
    const other = NuGetPanel.panels.get(target.key);
    if (other) {
      other.panel.reveal();
      this.postProject();
      return;
    }
    NuGetPanel.panels.delete(this.project.key);
    this.project = target;
    NuGetPanel.panels.set(target.key, this);
    this.panel.title = this.title();
    this.postProject();
    await this.refreshInstalled();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (NuGetPanel.panels.get(this.project.key) === this) NuGetPanel.panels.delete(this.project.key);
    for (const d of this.disposables) d.dispose();
    this.panel.dispose();
  }
}

export interface NuGetDeps {
  readonly manager: SolutionManager;
  readonly runner: DotnetRunner;
  readonly logger: Logger;
  readonly client: NuGetClient;
}
