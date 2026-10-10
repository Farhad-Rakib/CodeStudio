import * as vscode from 'vscode';
import { validateSolutionPath } from '../dotnet/dotnet-args';
import { cwdFor } from '../dotnet/dotnet-runner';
import { currentStandards, formatSeverity, StandardsController, standardsEnabled } from '../standards/standards-controller';
import { CommandContext, registerCommand, requireSolution, UserFacingError } from './command-context';

function requireEnabled(): void {
  if (!standardsEnabled()) {
    throw new UserFacingError('Coding standards are off. Enable "CodeStudio › Coding Standards: Enabled" in Settings first.');
  }
}

export function registerStandardsCommands(ctx: CommandContext, standards: StandardsController): void {
  registerCommand(ctx, 'codestudio.configureCodingStandards', 'Configure Coding Standards', () =>
    vscode.commands.executeCommand('workbench.action.openSettings', 'codestudio.codingStandards'));

  registerCommand(ctx, 'codestudio.renameToStandard', 'Rename to Coding Standard',
    (uri: vscode.Uri, offset: number, oldName: string, newName: string, range?: { start: number; end: number }) =>
      standards.renameToStandard(uri, offset, oldName, newName, range));

  registerCommand(ctx, 'codestudio.checkCodingStandards', 'Check Coding Standards', async () => {
    requireEnabled();
    const { model } = requireSolution(ctx);
    validateSolutionPath(model.path);
    await standards.syncEditorConfig();
    const args = ['format', 'style', model.path, '--verify-no-changes', '--severity', formatSeverity(currentStandards())];
    const code = await ctx.runner.runTask(`Check Coding Standards: ${model.name}`, args, cwdFor(model.path), model.path);
    if (code === 0) void vscode.window.showInformationMessage('CodeStudio: No coding standard violations found.');
    else void vscode.window.showWarningMessage('CodeStudio: Coding standard violations found. See the Problems panel.', 'Fix Automatically')
      .then(choice => { if (choice) void vscode.commands.executeCommand('codestudio.fixCodingStandards'); });
  });

  registerCommand(ctx, 'codestudio.fixCodingStandards', 'Fix Coding Standards', async () => {
    requireEnabled();
    const { model } = requireSolution(ctx);
    validateSolutionPath(model.path);
    const confirm = await vscode.window.showWarningMessage(
      `Apply coding-standard fixes to all files in ${model.name}?`,
      {
        modal: true,
        detail: 'Runs "dotnet format style", which edits source files to apply code-style rules (var usage, braces, namespaces, usings). ' +
          'Naming violations are not renamed automatically; use the lightbulb quick fix on each one. Commit or stash your changes first so you can review the result.',
      },
      'Fix',
    );
    if (confirm !== 'Fix') return;
    await standards.syncEditorConfig();
    const args = ['format', 'style', model.path, '--severity', formatSeverity(currentStandards())];
    const code = await ctx.runner.runTask(`Fix Coding Standards: ${model.name}`, args, cwdFor(model.path), model.path);
    if (code === 0) void vscode.window.showInformationMessage('CodeStudio: Code-style fixes applied. Remaining naming violations can be fixed with the lightbulb quick fix.');
    else void vscode.window.showErrorMessage(`CodeStudio: dotnet format exited with code ${code}. See the terminal output.`);
  });
}
