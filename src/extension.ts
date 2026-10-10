import * as vscode from 'vscode';
import { registerSolutionCommands } from './commands/build-solution';
import { CommandContext, registerCommand } from './commands/command-context';
import { registerFolderCommands } from './commands/folder-commands';
import { autoOpen, registerOpenSolutionCommands } from './commands/open-solution';
import { registerProjectCommands } from './commands/project-commands';
import { registerSettingsCommands } from './commands/settings-commands';
import { registerFormatCommands } from './commands/format-commands';
import { registerStandardsCommands } from './commands/standards-commands';
import { registerTemplateCommands } from './commands/template-commands';
import { DotnetRunner } from './dotnet/dotnet-runner';
import { ACTIVITY_BAR_VIEW, DefaultExplorerController, EXPLORER_VIEW } from './explorer/default-explorer';
import { ExplorerNode } from './explorer/solution-tree-item';
import { CSharpFormatter } from './format/csharp-formatter';
import { SolutionTreeProvider } from './explorer/solution-tree-provider';
import { Logger } from './logger';
import { SolutionManager } from './solution-manager';
import { StandardsController } from './standards/standards-controller';

/** Returned from activate() so integration tests can inspect state. */
export interface DotPilotApi {
  readonly manager: SolutionManager;
  readonly provider: SolutionTreeProvider;
  readonly defaultExplorer: DefaultExplorerController;
  readonly standards: StandardsController;
  readonly formatter: CSharpFormatter;
  /** Resolves once startup work (solution discovery, auto-open, layout sync) has finished. */
  readonly ready: Promise<void>;
}

export function activate(context: vscode.ExtensionContext): DotPilotApi {
  const logger = new Logger();
  const manager = new SolutionManager(context.workspaceState, logger);
  const runner = new DotnetRunner(logger);
  const provider = new SolutionTreeProvider(manager, logger);

  // The same tree is contributed twice: inside VS Code's Explorer (default-explorer mode) and in
  // the DotPilot activity bar container. `when` clauses on dotpilot.defaultExplorer pick one.
  const treeViews = [EXPLORER_VIEW, ACTIVITY_BAR_VIEW].map(id =>
    vscode.window.createTreeView<ExplorerNode>(id, {
      treeDataProvider: provider,
      dragAndDropController: provider,
      showCollapseAll: true,
      canSelectMany: true,
    }),
  );
  const setMessage = (message: string | undefined) => treeViews.forEach(v => (v.message = message));
  let workspaceHasSolution = false;
  const defaultExplorer = new DefaultExplorerController(context.globalState, logger, () => workspaceHasSolution || !!manager.solution);
  const standards = new StandardsController(manager, context.workspaceState, logger);
  const formatter = new CSharpFormatter(runner, logger);
  context.subscriptions.push(logger, manager, defaultExplorer, standards, formatter, ...treeViews);

  const ctx: CommandContext = { extension: context, manager, runner, provider, logger };
  registerOpenSolutionCommands(ctx);
  registerSolutionCommands(ctx);
  registerProjectCommands(ctx);
  registerFolderCommands(ctx);
  registerSettingsCommands(ctx);
  registerTemplateCommands(ctx);
  registerStandardsCommands(ctx, standards);
  registerFormatCommands(ctx);

  registerCommand(ctx, 'dotpilot.filter', 'Search Solution Explorer', async () => {
    const text = await vscode.window.showInputBox({
      prompt: 'Show folders and projects whose name contains...',
      value: provider.filter,
      placeHolder: 'Search Solution Explorer',
    });
    if (text === undefined) return;
    provider.setFilter(text);
    setMessage(provider.filter ? `Filtered by "${provider.filter}"` : undefined);
  });
  registerCommand(ctx, 'dotpilot.clearFilter', 'Clear Search', () => {
    provider.setFilter('');
    setMessage(undefined);
  });
  registerCommand(ctx, 'dotpilot.restoreDefaultExplorer', 'Restore VS Code Default Explorer', () => defaultExplorer.setEnabled(false));
  registerCommand(ctx, 'dotpilot.makeDefaultExplorer', 'Make Solution Explorer the Default Explorer', () => defaultExplorer.setEnabled(true));

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('dotpilot.dotnetPath')) runner.resetSdkCache();
      if (e.affectsConfiguration('dotpilot.explorer')) provider.refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      workspaceHasSolution = (await manager.discover()).length > 0;
      await vscode.commands.executeCommand('setContext', 'dotpilot.workspaceHasSolution', workspaceHasSolution);
      if (!manager.solution) await autoOpen(ctx);
      await defaultExplorer.sync();
    }),
    manager.onDidChange(() => {
      if (!workspaceHasSolution && manager.solution) {
        workspaceHasSolution = true;
        void vscode.commands.executeCommand('setContext', 'dotpilot.workspaceHasSolution', true);
        void defaultExplorer.sync();
      }
    }),
  );

  void vscode.commands.executeCommand('setContext', 'dotpilot.solutionLoaded', false);
  logger.info('DotPilot activated.');
  const ready = (async () => {
    // DotPilot also activates on startup in workspaces without a solution so it can restore the
    // Files view there (view visibility is remembered across workspaces).
    workspaceHasSolution = (await manager.discover()).length > 0;
    await vscode.commands.executeCommand('setContext', 'dotpilot.workspaceHasSolution', workspaceHasSolution);
    if (workspaceHasSolution) await autoOpen(ctx);
    await defaultExplorer.sync(!!manager.solution);
  })().catch(err => logger.error('Startup failed', err));

  return { manager, provider, defaultExplorer, standards, formatter, ready };
}

export function deactivate(): void {
  // Disposables registered on the extension context are cleaned up by VS Code.
}
