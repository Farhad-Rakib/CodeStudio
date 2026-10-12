import * as vscode from 'vscode';
import { registerSolutionCommands } from './commands/build-solution';
import { CommandContext, registerCommand } from './commands/command-context';
import { registerFileCommands } from './commands/file-commands';
import { registerFolderCommands } from './commands/folder-commands';
import { autoOpen, registerOpenSolutionCommands } from './commands/open-solution';
import { registerProjectCommands } from './commands/project-commands';
import { registerSettingsCommands } from './commands/settings-commands';
import { registerFormatCommands } from './commands/format-commands';
import { registerRunCommands } from './commands/run-commands';
import { registerSqlCommands } from './commands/sql-commands';
import { registerStandardsCommands } from './commands/standards-commands';
import { registerTemplateCommands } from './commands/template-commands';
import { DotnetRunner } from './dotnet/dotnet-runner';
import { ACTIVITY_BAR_VIEW, DefaultExplorerController, EXPLORER_VIEW } from './explorer/default-explorer';
import { ExplorerNode } from './explorer/solution-tree-item';
import { CSharpFormatter } from './format/csharp-formatter';
import { SolutionTreeProvider } from './explorer/solution-tree-provider';
import { Logger } from './logger';
import { ConfigurationController } from './run/configuration-controller';
import { StartupController } from './run/startup-controller';
import { SolutionManager } from './solution-manager';
import { StandardsController } from './standards/standards-controller';

/** Returned from activate() so integration tests can inspect state. */
export interface CodeXStudioApi {
  readonly manager: SolutionManager;
  readonly provider: SolutionTreeProvider;
  readonly defaultExplorer: DefaultExplorerController;
  readonly standards: StandardsController;
  readonly formatter: CSharpFormatter;
  readonly startup: StartupController;
  readonly configuration: ConfigurationController;
  /** Resolves once startup work (solution discovery, auto-open, layout sync) has finished. */
  readonly ready: Promise<void>;
}

export function activate(context: vscode.ExtensionContext): CodeXStudioApi {
  const logger = new Logger();
  const manager = new SolutionManager(context.workspaceState, logger);
  const runner = new DotnetRunner(logger);
  const provider = new SolutionTreeProvider(manager, logger, () => runner.ensureSdk().then(info => info.version, () => undefined));

  // The same tree is contributed twice: inside VS Code's Explorer (default-explorer mode) and in
  // the CodeXStudio activity bar container. `when` clauses on codestudio.defaultExplorer pick one.
  const treeViews = [EXPLORER_VIEW, ACTIVITY_BAR_VIEW].map(id =>
    vscode.window.createTreeView<ExplorerNode>(id, {
      treeDataProvider: provider,
      dragAndDropController: provider,
      showCollapseAll: true,
      canSelectMany: true,
    }),
  );
  treeViews.forEach(v => context.subscriptions.push(v.onDidChangeSelection(e => (provider.selection = e.selection))));
  const setMessage = (message: string | undefined) => treeViews.forEach(v => (v.message = message));
  let workspaceHasSolution = false;
  const defaultExplorer = new DefaultExplorerController(context.globalState, logger, () => workspaceHasSolution || !!manager.solution);
  const standards = new StandardsController(manager, context.workspaceState, logger);
  const formatter = new CSharpFormatter(runner, logger);
  const startup = new StartupController(manager, runner, logger);
  const configuration = new ConfigurationController(manager, logger);
  context.subscriptions.push(logger, manager, defaultExplorer, standards, formatter, startup, configuration, ...treeViews);

  const ctx: CommandContext = { extension: context, manager, runner, provider, logger };
  registerOpenSolutionCommands(ctx);
  registerSolutionCommands(ctx);
  registerProjectCommands(ctx);
  registerFolderCommands(ctx);
  registerFileCommands(ctx);
  registerSettingsCommands(ctx);
  registerTemplateCommands(ctx);
  registerStandardsCommands(ctx, standards);
  registerFormatCommands(ctx);
  registerRunCommands(ctx, startup, configuration);
  registerSqlCommands(ctx);

  registerCommand(ctx, 'codestudio.filter', 'Search Solution Explorer', async () => {
    const text = await vscode.window.showInputBox({
      prompt: 'Show folders and projects whose name contains...',
      value: provider.filter,
      placeHolder: 'Search Solution Explorer',
    });
    if (text === undefined) return;
    provider.setFilter(text);
    setMessage(provider.filter ? `Filtered by "${provider.filter}"` : undefined);
  });
  registerCommand(ctx, 'codestudio.clearFilter', 'Clear Search', () => {
    provider.setFilter('');
    setMessage(undefined);
  });
  registerCommand(ctx, 'codestudio.restoreDefaultExplorer', 'Move Solution Explorer to Its Own Sidebar', () => defaultExplorer.setEnabled(false));
  registerCommand(ctx, 'codestudio.makeDefaultExplorer', 'Show Solution Explorer in the Explorer Sidebar', () => defaultExplorer.setEnabled(true));

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('codestudio.dotnetPath')) runner.resetSdkCache();
      if (e.affectsConfiguration('codestudio.explorer')) provider.refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      workspaceHasSolution = (await manager.discover()).length > 0;
      await vscode.commands.executeCommand('setContext', 'codestudio.workspaceHasSolution', workspaceHasSolution);
      if (!manager.solution) await autoOpen(ctx);
      await defaultExplorer.sync();
    }),
    manager.onDidChange(() => {
      if (!workspaceHasSolution && manager.solution) {
        workspaceHasSolution = true;
        void vscode.commands.executeCommand('setContext', 'codestudio.workspaceHasSolution', true);
        void defaultExplorer.sync();
      }
    }),
  );

  void vscode.commands.executeCommand('setContext', 'codestudio.solutionLoaded', false);
  logger.info('CodeXStudio activated.');
  const ready = (async () => {
    // CodeXStudio also activates on startup in workspaces without a solution so it can restore the
    // Files view there (view visibility is remembered across workspaces).
    workspaceHasSolution = (await manager.discover()).length > 0;
    await vscode.commands.executeCommand('setContext', 'codestudio.workspaceHasSolution', workspaceHasSolution);
    if (workspaceHasSolution) await autoOpen(ctx);
    await defaultExplorer.sync(!!manager.solution);
  })().catch(err => logger.error('Startup failed', err));

  return { manager, provider, defaultExplorer, standards, formatter, startup, configuration, ready };
}

export function deactivate(): void {
  // Disposables registered on the extension context are cleaned up by VS Code.
}
