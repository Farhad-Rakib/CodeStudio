import * as path from 'path';
import * as vscode from 'vscode';
import { addProjectReferenceArgs } from '../dotnet/dotnet-args';
import { ExplorerNode } from '../explorer/solution-tree-item';
import { NuGetClient } from '../nuget/nuget-client';
import { NuGetPanel } from '../nuget/nuget-panel';
import { CommandContext, registerCommand, requireSolution, resolveProject, UserFacingError } from './command-context';
import { runDotnetTarget } from './build-solution';

const nugetClient = new NuGetClient();

export function registerProjectCommands(ctx: CommandContext): void {
  registerCommand(ctx, 'codestudio.openProjectFile', 'Open Project File', async (node?: unknown) => {
    const project = await resolveProject(ctx, node, 'Select a project file to open');
    if (!project) return;
    await vscode.window.showTextDocument(vscode.Uri.file(project.absolutePath));
  });

  registerCommand(ctx, 'codestudio.buildProject', 'Build Project', async (node?: unknown) => {
    const project = await resolveProject(ctx, node, 'Select a project to build');
    if (!project) return;
    await runDotnetTarget(ctx, 'build', project.absolutePath, `Build Project: ${project.name}`);
  });

  registerCommand(ctx, 'codestudio.runTests', 'Run Tests', async (node?: unknown) => {
    const project = await resolveProject(ctx, node, 'Select a test project');
    if (!project) return;
    const info = await ctx.manager.projectInfo(project.absolutePath);
    if (!info.isTestProject) {
      throw new UserFacingError(`${project.name} does not look like a test project (no test SDK package or <IsTestProject>true</IsTestProject>).`);
    }
    await runDotnetTarget(ctx, 'test', project.absolutePath, `Run Tests: ${project.name}`);
  });

  registerCommand(ctx, 'codestudio.addProjectReference', 'Add Project Reference', async (node?: unknown) => {
    const { model } = requireSolution(ctx);
    const project = await resolveProject(ctx, node, 'Select the project that will receive the reference');
    if (!project) return;
    const info = await ctx.manager.projectInfo(project.absolutePath);
    const existing = new Set(info.projectReferences.map(r => path.resolve(r.absolutePath)));
    const candidates = model.projects.filter(
      p => p.key !== project.key && !existing.has(path.resolve(p.absolutePath)) && p.kind !== 'other' && p.kind !== 'shared',
    );
    if (candidates.length === 0) throw new UserFacingError(`No other projects are available to reference from ${project.name}.`);
    const picks = await vscode.window.showQuickPick(
      candidates.map(p => ({ label: p.name, description: p.relativePath, project: p })),
      { canPickMany: true, placeHolder: `Add references to ${project.name}`, matchOnDescription: true },
    );
    if (!picks?.length) return;
    for (const pick of picks) {
      await ctx.runner.exec(addProjectReferenceArgs(project.absolutePath, pick.project.absolutePath), path.dirname(project.absolutePath));
    }
    void vscode.window.showInformationMessage(`CodeXStudio: Added ${picks.length} reference(s) to ${project.name}.`);
    await ctx.manager.reload();
  });

  registerCommand(ctx, 'codestudio.manageNuGetPackages', 'Manage NuGet Packages', async (node?: unknown) => {
    const project = await resolveProject(ctx, node, 'Manage NuGet packages for which project?');
    if (!project) return undefined;
    if (project.kind !== 'csharp' && project.kind !== 'fsharp' && project.kind !== 'vb') {
      throw new UserFacingError(`${project.name} does not support NuGet package references.`);
    }
    return NuGetPanel.open({ manager: ctx.manager, runner: ctx.runner, logger: ctx.logger, client: nugetClient }, project);
  });

  registerCommand(ctx, 'codestudio.openFile', 'Open', async (node?: ExplorerNode) => {
    if (node?.type === 'file') await vscode.commands.executeCommand('vscode.open', node.uri);
    else if (node?.type === 'structure' && node.node.kind === 'solutionItem') await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(node.node.filePath));
  });

  registerCommand(ctx, 'codestudio.revealInOS', 'Reveal in File Explorer', async (node?: ExplorerNode) => {
    let uri: vscode.Uri | undefined;
    if (node?.type === 'file' || node?.type === 'physicalFolder' || (node?.type === 'buildOutput' && node.exists)) uri = node.uri;
    else if (node?.type === 'structure' && node.node.kind === 'project') uri = vscode.Uri.file(node.node.project.absolutePath);
    if (uri) await vscode.commands.executeCommand('revealFileInOS', uri);
  });
}
