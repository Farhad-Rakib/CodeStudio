import * as path from 'path';
import * as vscode from 'vscode';
import { runProjectArgs, targetPathArgs, targetVerbArgs } from '../dotnet/dotnet-args';
import { DotnetRunner } from '../dotnet/dotnet-runner';
import { Logger } from '../logger';
import { SolutionManager } from '../solution-manager';
import { SolutionProject } from '../solution/solution-model';
import { setStartupProject } from '../storage/layout-store';
import { isRunnable, isWebProject } from './runnable';

const CSHARP_EXTENSION_ID = 'ms-dotnettools.csharp';

/**
 * Visual Studio-style startup project: stored in the CodeXStudio layout, shown in the status bar,
 * started with `dotnet run` (Start Without Debugging) or through the installed C# extension's
 * coreclr debugger (Start Debugging). CodeXStudio does not ship a debugger of its own.
 */
export class StartupController implements vscode.Disposable {
  private readonly statusItem = vscode.window.createStatusBarItem('codestudio.startup', vscode.StatusBarAlignment.Left, 50);
  private readonly disposables: vscode.Disposable[] = [this.statusItem];

  constructor(private readonly manager: SolutionManager, private readonly runner: DotnetRunner, private readonly logger: Logger) {
    this.statusItem.name = 'CodeXStudio Startup Project';
    this.disposables.push(manager.onDidChange(() => this.update()));
    this.update();
  }

  get startupProject(): SolutionProject | undefined {
    const loaded = this.manager.solution;
    const key = loaded?.layout.startupProject;
    return key ? loaded.model.projects.find(p => p.key === key) : undefined;
  }

  private update(): void {
    const loaded = this.manager.solution;
    const project = this.startupProject;
    void vscode.commands.executeCommand('setContext', 'codestudio.hasStartupProject', !!project);
    if (!loaded) {
      this.statusItem.hide();
      return;
    }
    if (project) {
      this.statusItem.text = `$(debug-start) ${project.name}`;
      this.statusItem.tooltip = new vscode.MarkdownString(`**Startup project:** ${project.name}\n\nClick to start debugging. Use the Solution Explorer menu to run without debugging or change the startup project.`);
      this.statusItem.command = 'codestudio.debugStartupProject';
    } else {
      this.statusItem.text = '$(debug-start) Set Startup Project';
      this.statusItem.tooltip = 'Choose which project Run and Debug start';
      this.statusItem.command = 'codestudio.selectStartupProject';
    }
    this.statusItem.show();
  }

  async setStartup(project: SolutionProject | undefined): Promise<void> {
    if (project) {
      const info = await this.manager.projectInfo(project.absolutePath).catch(() => undefined);
      if (info && !isRunnable(info)) {
        const choice = await vscode.window.showWarningMessage(
          `${project.name} does not look like an application (it is a ${info.isTestProject ? 'test project' : 'class library'}). Set it as the startup project anyway?`,
          { modal: true },
          'Set Anyway',
        );
        if (choice !== 'Set Anyway') return;
      }
    }
    await this.manager.updateLayout(l => setStartupProject(l, project?.key));
    this.logger.info(project ? `Startup project set to ${project.name}.` : 'Startup project cleared.');
  }

  /** Lets the user pick from runnable projects (falls back to all projects when none look runnable). */
  async pickStartup(): Promise<SolutionProject | undefined> {
    const loaded = this.manager.solution;
    if (!loaded) throw new Error('No solution is open.');
    const projects = loaded.model.projects.filter(p => p.kind === 'csharp' || p.kind === 'fsharp' || p.kind === 'vb');
    const runnable: SolutionProject[] = [];
    for (const p of projects) {
      const info = await this.manager.projectInfo(p.absolutePath).catch(() => undefined);
      if (info && isRunnable(info)) runnable.push(p);
    }
    const candidates = runnable.length ? runnable : projects;
    if (candidates.length === 0) throw new Error('The solution has no projects that can be started.');
    const current = loaded.layout.startupProject;
    const pick = await vscode.window.showQuickPick(
      candidates.map(p => ({ label: p.name, description: p.key === current ? 'current startup project' : p.relativePath, project: p })),
      { title: 'Set Startup Project', placeHolder: 'Which project should Run and Debug start?' },
    );
    if (!pick) return undefined;
    await this.manager.updateLayout(l => setStartupProject(l, pick.project.key));
    return pick.project;
  }

  /** The explicit project, else the startup project, else ask (and remember the answer). */
  private async target(project?: SolutionProject): Promise<SolutionProject | undefined> {
    return project ?? this.startupProject ?? (await this.pickStartup());
  }

  /** Start Without Debugging: `dotnet run --project` in a terminal task. */
  async run(project?: SolutionProject): Promise<vscode.TaskExecution | undefined> {
    const target = await this.target(project);
    if (!target) return undefined;
    return this.runner.startTask(`Run: ${target.name}`, runProjectArgs(target.absolutePath, this.manager.activeConfiguration), path.dirname(target.absolutePath), target.absolutePath);
  }

  /** Start Debugging: build, resolve the output assembly, then launch the coreclr debugger. */
  async debug(project?: SolutionProject): Promise<boolean> {
    const target = await this.target(project);
    if (!target) return false;
    if (!hasCoreClrDebugger()) {
      const choice = await vscode.window.showWarningMessage(
        `Debugging .NET needs a C# extension that provides the "coreclr" debugger. CodeXStudio uses it instead of shipping its own debugger.`,
        'Install C# Extension',
        'Start Without Debugging',
      );
      if (choice === 'Install C# Extension') await vscode.commands.executeCommand('workbench.extensions.search', CSHARP_EXTENSION_ID);
      if (choice === 'Start Without Debugging') await this.run(target);
      return false;
    }

    const info = await this.manager.projectInfo(target.absolutePath);
    const buildConfig = this.manager.activeConfiguration;
    const buildExit = await this.runner.runTask(`Build Project: ${target.name}`, targetVerbArgs('build', target.absolutePath, buildConfig), path.dirname(target.absolutePath), target.absolutePath);
    if (buildExit !== 0) {
      void vscode.window.showErrorMessage(`CodeXStudio: Build of ${target.name} failed, so debugging was not started. See the Problems panel.`);
      return false;
    }
    const { stdout } = await this.runner.exec(targetPathArgs(target.absolutePath, info.targetFrameworks.length > 1 ? info.targetFrameworks[0] : undefined, buildConfig), path.dirname(target.absolutePath));
    const program = stdout.trim().split(/\r?\n/).pop()?.trim();
    if (!program) throw new Error(`Could not determine the output assembly of ${target.name}.`);

    const web = isWebProject(info);
    const config: vscode.DebugConfiguration = {
      type: 'coreclr',
      request: 'launch',
      name: `CodeXStudio: ${target.name}`,
      program,
      args: [],
      cwd: path.dirname(target.absolutePath),
      stopAtEntry: false,
      console: 'internalConsole',
      env: web ? { ASPNETCORE_ENVIRONMENT: 'Development' } : {},
    };
    if (web) config.serverReadyAction = { action: 'openExternally', pattern: '\\bNow listening on:\\s+(https?://\\S+)' };
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(target.absolutePath));
    this.logger.info(`Debugging ${program}`);
    return vscode.debug.startDebugging(folder, config);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

export function hasCoreClrDebugger(): boolean {
  return vscode.extensions.all.some(e =>
    (e.packageJSON?.contributes?.debuggers as { type?: string }[] | undefined)?.some(d => d.type === 'coreclr'));
}
