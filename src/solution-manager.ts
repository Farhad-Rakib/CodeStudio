import * as path from 'path';
import * as vscode from 'vscode';
import { Logger } from './logger';
import { JsonLayoutStore, LayoutStore, SolutionLayout } from './storage/layout-store';
import { BuildConfiguration, resolveActiveConfiguration } from './solution/build-configuration';
import { ProjectInfo, readProject } from './solution/project-reader';
import { SolutionModel } from './solution/solution-model';
import { readSolution } from './solution/solution-reader';

const LAST_SOLUTION_KEY = 'codestudio.lastSolution';

export interface LoadedSolution {
  readonly model: SolutionModel;
  readonly layout: SolutionLayout;
  readonly store: LayoutStore;
}

/** Owns the currently open solution, its layout, and file watching. Has no tree/UI knowledge. */
export class SolutionManager implements vscode.Disposable {
  private current: LoadedSolution | undefined;
  private loadError: string | undefined;
  private readonly projectCache = new Map<string, Promise<ProjectInfo>>();
  private watchers: vscode.Disposable[] = [];
  private reloadTimer: NodeJS.Timeout | undefined;
  private layoutWriteInProgress = 0;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor(private readonly state: vscode.Memento, private readonly logger: Logger) {}

  /** The build configuration Build/Clean/Test/Run/Debug use; undefined when no solution is open. */
  get activeConfiguration(): BuildConfiguration | undefined {
    const cur = this.current;
    return cur ? resolveActiveConfiguration(cur.model.configurations, cur.layout.activeConfiguration) : undefined;
  }

  get solution(): LoadedSolution | undefined {
    return this.current;
  }

  get error(): string | undefined {
    return this.loadError;
  }

  /** Lists .sln/.slnx files in the workspace, excluding build output folders. */
  async discover(): Promise<vscode.Uri[]> {
    const uris = await vscode.workspace.findFiles('**/*.{sln,slnx}', '**/{node_modules,bin,obj,.git}/**', 200);
    return uris.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
  }

  get lastSolutionPath(): string | undefined {
    return this.state.get<string>(LAST_SOLUTION_KEY);
  }

  /** Loads a solution. Throws on parse errors; the previous solution stays open in that case. */
  async open(solutionPath: string): Promise<LoadedSolution> {
    const resolved = path.resolve(solutionPath);
    const model = await readSolution(resolved);
    const store = new JsonLayoutStore(resolved);
    const layout = await store.load();
    for (const w of model.warnings) this.logger.warn(`${path.basename(resolved)}: ${w}`);
    this.logger.info(`Opened ${resolved} (${model.projects.length} projects, ${model.folders.length} solution folders, ${layout.folders.length} virtual folders).`);

    this.current = { model, layout, store };
    this.loadError = undefined;
    this.projectCache.clear();
    await this.state.update(LAST_SOLUTION_KEY, resolved);
    this.watch(resolved, store.location);
    await vscode.commands.executeCommand('setContext', 'codestudio.solutionLoaded', true);
    this.changed.fire();
    return this.current;
  }

  /** Re-reads the solution, layout and project files from disk. */
  async reload(): Promise<void> {
    if (!this.current) return;
    const solutionPath = this.current.model.path;
    try {
      const model = await readSolution(solutionPath);
      const layout = await this.current.store.load();
      this.current = { ...this.current, model, layout };
      this.loadError = undefined;
    } catch (err) {
      // Keep showing the last good tree but surface the problem.
      this.loadError = (err as Error).message;
      this.logger.error(`Reload of ${solutionPath} failed`, err);
    }
    this.projectCache.clear();
    this.changed.fire();
  }

  /** Applies a pure layout transformation, persists it, and refreshes the tree. */
  async updateLayout(transform: (layout: SolutionLayout) => SolutionLayout): Promise<void> {
    const cur = this.current;
    if (!cur) throw new Error('No solution is open.');
    const next = transform(cur.layout);
    this.layoutWriteInProgress++;
    try {
      await cur.store.save(next);
    } finally {
      // Ignore the watcher event caused by our own write.
      setTimeout(() => this.layoutWriteInProgress--, 500);
    }
    this.current = { ...cur, layout: next };
    this.changed.fire();
  }

  projectInfo(projectPath: string): Promise<ProjectInfo> {
    let info = this.projectCache.get(projectPath);
    if (!info) {
      info = readProject(projectPath);
      info.catch(() => this.projectCache.delete(projectPath));
      this.projectCache.set(projectPath, info);
    }
    return info;
  }

  private watch(solutionPath: string, layoutPath: string): void {
    this.disposeWatchers();
    const dir = path.dirname(solutionPath);
    const schedule = (reason: string) => {
      if (reason === 'layout' && this.layoutWriteInProgress > 0) return;
      clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => {
        this.logger.info(`Reloading solution (${reason} changed).`);
        void this.reload();
      }, 300);
    };
    const add = (pattern: vscode.GlobPattern, reason: string) => {
      const w = vscode.workspace.createFileSystemWatcher(pattern);
      w.onDidChange(() => schedule(reason));
      w.onDidCreate(() => schedule(reason));
      w.onDidDelete(() => schedule(reason));
      this.watchers.push(w);
    };
    add(new vscode.RelativePattern(dir, path.basename(solutionPath)), 'solution');
    add(new vscode.RelativePattern(path.dirname(layoutPath), path.basename(layoutPath)), 'layout');
    add(new vscode.RelativePattern(dir, '**/*.{csproj,fsproj,vbproj,sqlproj}'), 'project');
  }

  private disposeWatchers(): void {
    for (const w of this.watchers) w.dispose();
    this.watchers = [];
  }

  dispose(): void {
    clearTimeout(this.reloadTimer);
    this.disposeWatchers();
    this.changed.dispose();
  }
}
