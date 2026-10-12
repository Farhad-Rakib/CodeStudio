import * as vscode from 'vscode';
import { DotnetRunner } from '../dotnet/dotnet-runner';
import { ExplorerNode } from '../explorer/solution-tree-item';
import { SolutionTreeProvider } from '../explorer/solution-tree-provider';
import { Logger, reportError } from '../logger';
import { LoadedSolution, SolutionManager } from '../solution-manager';
import { SolutionModel, SolutionProject } from '../solution/solution-model';
import { solutionFolderPath } from '../solution/solution-folder-writer';
import { LayoutError } from '../storage/layout-store';
import { DotnetArgumentError } from '../dotnet/dotnet-args';

export interface CommandContext {
  readonly extension: vscode.ExtensionContext;
  readonly manager: SolutionManager;
  readonly runner: DotnetRunner;
  readonly provider: SolutionTreeProvider;
  readonly logger: Logger;
}

/** Registers a command whose failures are logged and shown as actionable errors. */
export function registerCommand(ctx: CommandContext, id: string, title: string, handler: (...args: any[]) => unknown): void {
  ctx.extension.subscriptions.push(
    vscode.commands.registerCommand(id, async (...args: unknown[]) => {
      try {
        return await handler(...args);
      } catch (err) {
        // Validation errors are user mistakes: show them plainly without the log prompt.
        if (err instanceof LayoutError || err instanceof DotnetArgumentError || err instanceof UserFacingError) {
          void vscode.window.showErrorMessage(`CodeXStudio: ${err.message}`);
          return undefined;
        }
        await reportError(ctx.logger, title, err);
        return undefined;
      }
    }),
  );
}

export class UserFacingError extends Error {}

/** The native solution folder a command was run on: its id and the "a/b" path `dotnet sln add --solution-folder` expects. */
export function solutionFolderTarget(model: SolutionModel, node: unknown): { id: string; path: string } | undefined {
  const n = node as ExplorerNode | undefined;
  if (n?.type !== 'structure' || n.node.kind !== 'solutionFolder') return undefined;
  return { id: n.node.folder.id, path: solutionFolderPath(model, n.node.folder.id) };
}

/** Projects inside a native solution folder, including its sub-folders. */
export function projectsInSolutionFolder(model: SolutionModel, folderId: string): SolutionProject[] {
  const inside = (id: string | undefined): boolean => {
    for (let cur = id, guard = 0; cur !== undefined && guard < 1000; guard++) {
      if (cur === folderId) return true;
      cur = model.folders.find(f => f.id === cur)?.parentFolderId;
    }
    return false;
  };
  return model.projects.filter(p => inside(p.parentFolderId));
}

export function requireSolution(ctx: CommandContext): LoadedSolution {
  const loaded = ctx.manager.solution;
  if (!loaded) throw new UserFacingError('No solution is open. Run "CodeXStudio: Open Solution" first.');
  return loaded;
}

/** Resolves the project a command targets: the clicked tree node, or a quick pick from the palette. */
export async function resolveProject(ctx: CommandContext, node: unknown, placeHolder: string): Promise<SolutionProject | undefined> {
  const loaded = requireSolution(ctx);
  const n = node as ExplorerNode | undefined;
  if (n?.type === 'structure' && n.node.kind === 'project') return n.node.project;
  if (loaded.model.projects.length === 0) throw new UserFacingError('The solution contains no projects.');
  const pick = await vscode.window.showQuickPick(
    loaded.model.projects.map(p => ({ label: p.name, description: p.relativePath, project: p })),
    { placeHolder, matchOnDescription: true },
  );
  return pick?.project;
}
