import * as path from 'path';
import * as vscode from 'vscode';
import { addProjectToSolutionArgs, addProjectToSolutionFolderArgs, SolutionVerb, targetVerbArgs } from '../dotnet/dotnet-args';
import { cwdFor } from '../dotnet/dotnet-runner';
import { SdkNotFoundError } from '../dotnet/sdk-detection';
import { standardsConfig, standardsEnabled } from '../standards/standards-controller';
import { CommandContext, registerCommand, requireSolution, solutionFolderTarget } from './command-context';
import { warnIncompatibleSqlProjects } from './sql-commands';

const VERB_TITLES: Record<Exclude<SolutionVerb, 'test'>, string> = { build: 'Build Solution', restore: 'Restore Solution', clean: 'Clean Solution' };

export async function runDotnetTarget(ctx: CommandContext, verb: SolutionVerb, target: string, label: string): Promise<void> {
  const args = targetVerbArgs(verb, target, ctx.manager.activeConfiguration);
  if ((verb === 'build' || verb === 'test') && standardsEnabled() && standardsConfig().get<boolean>('enforceInBuild', false)) {
    // Makes Roslyn report .editorconfig code-style and naming rules (IDE*) during the build.
    args.push('-p:EnforceCodeStyleInBuild=true');
  }
  if (verb === 'build') await warnIncompatibleSqlProjects(ctx, target);
  let exitCode: number | undefined;
  try {
    exitCode = await ctx.runner.runTask(label, args, cwdFor(target), target);
  } catch (err) {
    if (err instanceof SdkNotFoundError) {
      const choice = await vscode.window.showErrorMessage(`CodeXStudio: ${err.message}`, 'Open Settings', 'Download .NET');
      if (choice === 'Open Settings') void vscode.commands.executeCommand('workbench.action.openSettings', 'codestudio.dotnetPath');
      if (choice === 'Download .NET') void vscode.env.openExternal(vscode.Uri.parse('https://dotnet.microsoft.com/download'));
      return;
    }
    throw err;
  }
  // Build output nodes (.dacpac) depend on what is on disk now.
  if (verb === 'build' || verb === 'clean') ctx.provider.refresh();
  if (exitCode === 0) {
    void vscode.window.setStatusBarMessage(`$(check) CodeXStudio: ${label} succeeded`, 5000);
  } else {
    const choice = await vscode.window.showErrorMessage(
      `CodeXStudio: ${label} failed${exitCode !== undefined ? ` (exit code ${exitCode})` : ''}. See the terminal output and the Problems panel.`,
      'Show Problems',
    );
    if (choice) void vscode.commands.executeCommand('workbench.actions.view.problems');
  }
}

export function registerSolutionCommands(ctx: CommandContext): void {
  for (const verb of Object.keys(VERB_TITLES) as (keyof typeof VERB_TITLES)[]) {
    const title = VERB_TITLES[verb];
    const id = `codestudio.${verb}Solution`;
    registerCommand(ctx, id, title, async () => {
      const { model } = requireSolution(ctx);
      await runDotnetTarget(ctx, verb, model.path, `${title}: ${model.name}`);
    });
  }

  registerCommand(ctx, 'codestudio.addExistingProject', 'Add Existing Project', async (node?: unknown) => {
    const { model } = requireSolution(ctx);
    const solutionFolder = solutionFolderTarget(model, node);
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: true,
      defaultUri: vscode.Uri.file(model.directory),
      openLabel: 'Add to Solution',
      filters: { 'Project files': ['csproj', 'fsproj', 'vbproj', 'sqlproj'] },
    });
    if (!picked?.length) return;
    for (const uri of picked) {
      const already = model.projects.some(p => path.resolve(p.absolutePath) === path.resolve(uri.fsPath));
      if (already) {
        void vscode.window.showWarningMessage(`CodeXStudio: ${path.basename(uri.fsPath)} is already in the solution.`);
        continue;
      }
      // `dotnet sln add` edits the solution with the SDK's own serializer; CodeXStudio never rewrites .sln text itself.
      await ctx.runner.exec(
        solutionFolder ? addProjectToSolutionFolderArgs(model.path, uri.fsPath, solutionFolder.path) : addProjectToSolutionArgs(model.path, uri.fsPath),
        model.directory,
      );
      void vscode.window.showInformationMessage(`CodeXStudio: Added ${path.basename(uri.fsPath)} to ${model.name}.`);
    }
    await ctx.manager.reload();
  });

  registerCommand(ctx, 'codestudio.showSdkInfo', 'Show .NET SDK Info', async () => {
    ctx.runner.resetSdkCache();
    try {
      const info = await ctx.runner.ensureSdk();
      const list = info.sdks.map(s => s.version).join(', ') || 'unknown';
      void vscode.window.showInformationMessage(`CodeXStudio: .NET SDK ${info.version} is active. Installed SDKs: ${list}.`);
    } catch (err) {
      if (err instanceof SdkNotFoundError) {
        void vscode.window.showErrorMessage(`CodeXStudio: ${err.message}`);
        return;
      }
      throw err;
    }
  });

  registerCommand(ctx, 'codestudio.showLog', 'Show Log', () => ctx.logger.show());
}
