import * as path from 'path';
import * as vscode from 'vscode';
import { CommandContext, registerCommand } from './command-context';

export function registerOpenSolutionCommands(ctx: CommandContext): void {
  registerCommand(ctx, 'codestudio.openSolution', 'Open Solution', async (arg?: unknown) => {
    const target = arg instanceof vscode.Uri ? arg.fsPath : typeof arg === 'string' ? arg : await pickSolution(ctx);
    if (!target) return;
    await openWithFeedback(ctx, target);
  });

  registerCommand(ctx, 'codestudio.refresh', 'Refresh', async () => {
    if (!ctx.manager.solution) {
      await autoOpen(ctx, true);
      return;
    }
    await ctx.manager.reload();
  });
}

async function pickSolution(ctx: CommandContext): Promise<string | undefined> {
  const found = await ctx.manager.discover();
  const browse = { label: '$(folder-opened) Browse...', description: 'Choose a .sln or .slnx file', path: undefined as string | undefined };
  const items = found.map(uri => ({
    label: `$(layers) ${path.basename(uri.fsPath)}`,
    description: vscode.workspace.asRelativePath(path.dirname(uri.fsPath)),
    path: uri.fsPath as string | undefined,
  }));
  const pick = await vscode.window.showQuickPick([...items, browse], {
    placeHolder: found.length ? 'Select a solution to open' : 'No solutions found in the workspace',
  });
  if (!pick) return undefined;
  if (pick.path) return pick.path;
  const chosen = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: 'Open Solution',
    filters: { 'Solution files': ['sln', 'slnx'] },
  });
  return chosen?.[0]?.fsPath;
}

async function openWithFeedback(ctx: CommandContext, solutionPath: string): Promise<void> {
  const loaded = await ctx.manager.open(solutionPath);
  if (loaded.model.warnings.length) {
    const choice = await vscode.window.showWarningMessage(
      `CodeXStudio: ${path.basename(solutionPath)} opened with ${loaded.model.warnings.length} warning(s).`,
      'Show Log',
    );
    if (choice) ctx.logger.show();
  }
}

/** Opens the last solution, or the only solution in the workspace. Errors are logged, not thrown. */
export async function autoOpen(ctx: CommandContext, interactive = false): Promise<void> {
  try {
    const last = ctx.manager.lastSolutionPath;
    const found = await ctx.manager.discover();
    const lastStillPresent = last && found.some(u => path.resolve(u.fsPath) === last);
    const enabled = vscode.workspace.getConfiguration('codestudio').get<boolean>('autoOpenSingleSolution', true);
    if (lastStillPresent) await openWithFeedback(ctx, last);
    else if (found.length === 1 && (enabled || interactive)) await openWithFeedback(ctx, found[0].fsPath);
    else if (interactive && found.length > 1) await vscode.commands.executeCommand('codestudio.openSolution');
    else if (interactive) void vscode.window.showInformationMessage('CodeXStudio: No .sln or .slnx files were found in this workspace.');
  } catch (err) {
    ctx.logger.error('Automatic solution load failed', err);
    const choice = await vscode.window.showErrorMessage(`CodeXStudio: Could not open solution. ${(err as Error).message}`, 'Show Log');
    if (choice) ctx.logger.show();
  }
}
