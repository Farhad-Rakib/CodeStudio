import * as path from 'path';
import * as vscode from 'vscode';
import { addProjectToSolutionArgs, SolutionVerb, targetVerbArgs } from '../dotnet/dotnet-args';
import { cwdFor } from '../dotnet/dotnet-runner';
import { SdkNotFoundError } from '../dotnet/sdk-detection';
import { standardsConfig, standardsEnabled } from '../standards/standards-controller';
import { CommandContext, registerCommand, requireSolution } from './command-context';

const VERB_TITLES: Record<Exclude<SolutionVerb, 'test'>, string> = { build: 'Build Solution', restore: 'Restore Solution', clean: 'Clean Solution' };

export async function runDotnetTarget(ctx: CommandContext, verb: SolutionVerb, target: string, label: string): Promise<void> {
  const args = targetVerbArgs(verb, target);
  if ((verb === 'build' || verb === 'test') && standardsEnabled() && standardsConfig().get<boolean>('enforceInBuild', false)) {
    // Makes Roslyn report .editorconfig code-style and naming rules (IDE*) during the build.
    args.push('-p:EnforceCodeStyleInBuild=true');
  }
  let exitCode: number | undefined;
  try {
    exitCode = await ctx.runner.runTask(label, args, cwdFor(target), target);
  } catch (err) {
    if (err instanceof SdkNotFoundError) {
      const choice = await vscode.window.showErrorMessage(`DotPilot: ${err.message}`, 'Open Settings', 'Download .NET');
      if (choice === 'Open Settings') void vscode.commands.executeCommand('workbench.action.openSettings', 'dotpilot.dotnetPath');
      if (choice === 'Download .NET') void vscode.env.openExternal(vscode.Uri.parse('https://dotnet.microsoft.com/download'));
      return;
    }
    throw err;
  }
  if (exitCode === 0) {
    void vscode.window.setStatusBarMessage(`$(check) DotPilot: ${label} succeeded`, 5000);
  } else {
    const choice = await vscode.window.showErrorMessage(
      `DotPilot: ${label} failed${exitCode !== undefined ? ` (exit code ${exitCode})` : ''}. See the terminal output and the Problems panel.`,
      'Show Problems',
    );
    if (choice) void vscode.commands.executeCommand('workbench.actions.view.problems');
  }
}

export function registerSolutionCommands(ctx: CommandContext): void {
  for (const verb of Object.keys(VERB_TITLES) as (keyof typeof VERB_TITLES)[]) {
    const title = VERB_TITLES[verb];
    const id = `dotpilot.${verb}Solution`;
    registerCommand(ctx, id, title, async () => {
      const { model } = requireSolution(ctx);
      await runDotnetTarget(ctx, verb, model.path, `${title}: ${model.name}`);
    });
  }

  registerCommand(ctx, 'dotpilot.addExistingProject', 'Add Existing Project', async () => {
    const { model } = requireSolution(ctx);
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
        void vscode.window.showWarningMessage(`DotPilot: ${path.basename(uri.fsPath)} is already in the solution.`);
        continue;
      }
      // `dotnet sln add` edits the solution with the SDK's own serializer; DotPilot never rewrites .sln text itself.
      await ctx.runner.exec(addProjectToSolutionArgs(model.path, uri.fsPath), model.directory);
      void vscode.window.showInformationMessage(`DotPilot: Added ${path.basename(uri.fsPath)} to ${model.name}.`);
    }
    await ctx.manager.reload();
  });

  registerCommand(ctx, 'dotpilot.showSdkInfo', 'Show .NET SDK Info', async () => {
    ctx.runner.resetSdkCache();
    try {
      const info = await ctx.runner.ensureSdk();
      const list = info.sdks.map(s => s.version).join(', ') || 'unknown';
      void vscode.window.showInformationMessage(`DotPilot: .NET SDK ${info.version} is active. Installed SDKs: ${list}.`);
    } catch (err) {
      if (err instanceof SdkNotFoundError) {
        void vscode.window.showErrorMessage(`DotPilot: ${err.message}`);
        return;
      }
      throw err;
    }
  });

  registerCommand(ctx, 'dotpilot.showLog', 'Show Log', () => ctx.logger.show());
}
