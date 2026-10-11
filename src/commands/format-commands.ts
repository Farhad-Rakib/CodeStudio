import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CommandContext, registerCommand } from './command-context';

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export function registerFormatCommands(ctx: CommandContext): void {
  registerCommand(ctx, 'codestudio.installCSharpier', 'Install CSharpier', async () => {
    const solutionDir = ctx.manager.solution?.model.directory;
    const choices: (vscode.QuickPickItem & { scope: 'local' | 'global' })[] = [];
    if (solutionDir) {
      choices.push({ label: '$(folder) Local tool for this solution', description: 'Recommended', detail: `Adds CSharpier to the dotnet tool manifest in ${vscode.workspace.asRelativePath(solutionDir)} so everyone on the team uses the same version`, scope: 'local' });
    }
    choices.push({ label: '$(globe) Global tool', detail: 'dotnet tool install -g csharpier (available in every folder on this machine)', scope: 'global' });
    const pick = await vscode.window.showQuickPick(choices, { title: 'Install CSharpier (the opinionated "Prettier" formatter for C#)' });
    if (!pick) return;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Installing CSharpier...' }, async () => {
      if (pick.scope === 'global') {
        await ctx.runner.exec(['tool', 'install', '-g', 'csharpier'], solutionDir ?? process.cwd(), 300000);
      } else {
        const dir = solutionDir!;
        const hasManifest = (await exists(path.join(dir, '.config', 'dotnet-tools.json'))) || (await exists(path.join(dir, 'dotnet-tools.json')));
        if (!hasManifest) await ctx.runner.exec(['new', 'tool-manifest'], dir, 60000);
        await ctx.runner.exec(['tool', 'install', 'csharpier'], dir, 300000);
      }
    });
    await vscode.workspace.getConfiguration('codestudio.formatter').update('engine', 'csharpier', vscode.ConfigurationTarget.Workspace);
    void vscode.window.showInformationMessage('CodeXStudio: CSharpier installed and selected as the C# formatter.');
  });

  registerCommand(ctx, 'codestudio.formatDocument', 'Format Document', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    await vscode.commands.executeCommand('editor.action.formatDocument.multiple');
  });
}
