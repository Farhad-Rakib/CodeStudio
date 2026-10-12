import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import { addProjectToSolutionFolderArgs, removeProjectFromSolutionArgs } from '../dotnet/dotnet-args';
import { SolutionFolder } from '../solution/solution-model';
import { addSolutionFolder, solutionFolderPath, validateSolutionFolderName } from '../solution/solution-folder-writer';
import { ExplorerNode } from '../explorer/solution-tree-item';
import {
  assignProject,
  createFolder,
  deleteFolder,
  descendantIds,
  folderPath,
  renameFolder,
  validateFolderName,
  VirtualFolder,
} from '../storage/layout-store';
import { CommandContext, registerCommand, requireSolution, resolveProject, UserFacingError } from './command-context';

function virtualFolderOf(node: unknown): VirtualFolder | undefined {
  const n = node as ExplorerNode | undefined;
  return n?.type === 'structure' && n.node.kind === 'virtualFolder' ? n.node.folder : undefined;
}

async function pickVirtualFolder(ctx: CommandContext, placeHolder: string, includeRoot: boolean): Promise<{ id: string | undefined } | undefined> {
  const { layout } = requireSolution(ctx);
  const items: (vscode.QuickPickItem & { id: string | undefined })[] = layout.folders
    .map(f => ({ label: `$(folder) ${folderPath(layout, f.id)}`, id: f.id as string | undefined }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (includeRoot) items.unshift({ label: '$(layers) (Solution root)', description: 'Restore the native solution location', id: undefined });
  if (items.length === 0) throw new UserFacingError('There are no virtual folders yet. Use "Add Virtual Folder" first.');
  return vscode.window.showQuickPick(items, { placeHolder });
}

function solutionFolderOf(node: unknown): SolutionFolder | undefined {
  const n = node as ExplorerNode | undefined;
  return n?.type === 'structure' && n.node.kind === 'solutionFolder' ? n.node.folder : undefined;
}

export function registerFolderCommands(ctx: CommandContext): void {
  registerCommand(ctx, 'codestudio.addSolutionFolder', 'New Solution Folder', async (node?: unknown) => {
    const { model } = requireSolution(ctx);
    const parent = solutionFolderOf(node);
    const name = await vscode.window.showInputBox({
      title: parent ? `New solution folder in "${parent.name}"` : 'New solution folder',
      prompt: `Adds a solution folder to ${model.name}.${model.format}; nothing is created on disk.`,
      value: 'New Folder',
      validateInput: v => validateSolutionFolderName(model, v, parent?.id),
    });
    if (name === undefined) return;
    // The dotnet CLI cannot create an empty solution folder, so this is a minimal text insertion.
    const text = await fs.readFile(model.path, 'utf8');
    await fs.writeFile(model.path, addSolutionFolder(model.format, text, model, name, parent?.id, randomUUID()), 'utf8');
    await ctx.manager.reload();
  });

  registerCommand(ctx, 'codestudio.moveProjectToSolutionFolder', 'Move Project to Solution Folder', async (node?: unknown) => {
    const { model } = requireSolution(ctx);
    const project = await resolveProject(ctx, node, 'Select a project to move');
    if (!project) return;
    const items: (vscode.QuickPickItem & { folderPath: string | undefined })[] = model.folders
      .filter(f => f.id !== project.parentFolderId)
      .map(f => ({ label: `$(folder-library) ${solutionFolderPath(model, f.id)}`, folderPath: solutionFolderPath(model, f.id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (project.parentFolderId !== undefined) items.unshift({ label: '$(layers) (Solution root)', folderPath: undefined });
    if (items.length === 0) throw new UserFacingError('There are no other solution folders. Use "New Solution Folder" first.');
    const pick = await vscode.window.showQuickPick(items, { placeHolder: `Move ${project.name} to...` });
    if (!pick) return;
    // `dotnet sln add` will not move a project that is already listed, so remove it first.
    // If the add fails, restore the original solution text so the project is never lost.
    const original = await fs.readFile(model.path);
    await ctx.runner.exec(removeProjectFromSolutionArgs(model.path, project.absolutePath), model.directory);
    try {
      await ctx.runner.exec(addProjectToSolutionFolderArgs(model.path, project.absolutePath, pick.folderPath), model.directory);
    } catch (err) {
      await fs.writeFile(model.path, original);
      throw err;
    } finally {
      await ctx.manager.reload();
    }
  });

  registerCommand(ctx, 'codestudio.addVirtualFolder', 'Add Virtual Folder', async (node?: unknown) => {
    const { layout } = requireSolution(ctx);
    const parent = virtualFolderOf(node);
    const name = await vscode.window.showInputBox({
      title: parent ? `New virtual folder in "${parent.name}"` : 'New virtual folder',
      prompt: 'Virtual folders organize projects in CodeXStudio only; nothing moves on disk.',
      value: 'New Folder',
      validateInput: v => {
        const err = validateFolderName(v);
        if (err) return err;
        const clash = layout.folders.some(f => f.parentId === parent?.id && f.name.toLowerCase() === v.trim().toLowerCase());
        return clash ? `A virtual folder named "${v.trim()}" already exists here.` : undefined;
      },
    });
    if (name === undefined) return;
    await ctx.manager.updateLayout(l => createFolder(l, name, parent?.id).layout);
  });

  registerCommand(ctx, 'codestudio.renameVirtualFolder', 'Rename Virtual Folder', async (node?: unknown) => {
    requireSolution(ctx);
    let folder = virtualFolderOf(node);
    if (!folder) {
      const pick = await pickVirtualFolder(ctx, 'Select a virtual folder to rename', false);
      folder = ctx.manager.solution?.layout.folders.find(f => f.id === pick?.id);
    }
    if (!folder) return;
    const target = folder;
    const name = await vscode.window.showInputBox({ title: `Rename "${target.name}"`, value: target.name, validateInput: validateFolderName });
    if (name === undefined || name.trim() === target.name) return;
    await ctx.manager.updateLayout(l => renameFolder(l, target.id, name));
  });

  registerCommand(ctx, 'codestudio.deleteVirtualFolder', 'Delete Virtual Folder', async (node?: unknown) => {
    const { layout } = requireSolution(ctx);
    let folder = virtualFolderOf(node);
    if (!folder) {
      const pick = await pickVirtualFolder(ctx, 'Select a virtual folder to delete', false);
      folder = layout.folders.find(f => f.id === pick?.id);
    }
    if (!folder) return;
    const target = folder;
    const ids = descendantIds(layout, target.id);
    const projectCount = Object.values(layout.assignments).filter(id => ids.has(id)).length;
    const detail = [
      ids.size > 1 ? `${ids.size - 1} sub-folder(s) will also be removed.` : '',
      projectCount ? `${projectCount} project(s) will return to their solution location.` : '',
      'No files or projects are deleted.',
    ].filter(Boolean).join(' ');
    const confirm = await vscode.window.showWarningMessage(`Delete virtual folder "${target.name}"?`, { modal: true, detail }, 'Delete');
    if (confirm !== 'Delete') return;
    await ctx.manager.updateLayout(l => deleteFolder(l, target.id));
  });

  registerCommand(ctx, 'codestudio.moveProjectHere', 'Move Project Here', async (node?: unknown) => {
    const { model, layout } = requireSolution(ctx);
    const folder = virtualFolderOf(node);
    if (!folder) throw new UserFacingError('Run "Move Project Here" from a virtual folder in the Solution Explorer.');
    const candidates = model.projects.filter(p => layout.assignments[p.key] !== folder.id);
    if (candidates.length === 0) throw new UserFacingError(`All projects are already in "${folder.name}".`);
    const picks = await vscode.window.showQuickPick(
      candidates.map(p => ({
        label: p.name,
        description: layout.assignments[p.key] ? `in ${folderPath(layout, layout.assignments[p.key])}` : p.relativePath,
        key: p.key,
      })),
      { canPickMany: true, placeHolder: `Move projects into "${folder.name}" (files stay where they are)` },
    );
    if (!picks?.length) return;
    await ctx.manager.updateLayout(l => picks.reduce((acc, p) => assignProject(acc, p.key, folder.id), l));
  });

  registerCommand(ctx, 'codestudio.moveProjectToFolder', 'Move Project to Virtual Folder', async (node?: unknown) => {
    const project = await resolveProject(ctx, node, 'Select a project to move');
    if (!project) return;
    const pick = await pickVirtualFolder(ctx, `Move ${project.name} to...`, true);
    if (!pick) return;
    await ctx.manager.updateLayout(l => assignProject(l, project.key, pick.id));
  });

  registerCommand(ctx, 'codestudio.removeFromVirtualFolder', 'Remove from Virtual Folder', async (node?: unknown) => {
    const project = await resolveProject(ctx, node, 'Select a project');
    if (!project) return;
    await ctx.manager.updateLayout(l => assignProject(l, project.key, undefined));
  });
}
