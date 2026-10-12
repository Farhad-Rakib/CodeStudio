import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import { addProjectToSolutionFolderArgs, removeProjectFromSolutionArgs } from '../dotnet/dotnet-args';
import * as path from 'path';
import { normalizeRelativePath, SolutionFolder, SolutionModel, SolutionProject } from '../solution/solution-model';
import { deleteEntries, FileOperationError, renameEntry } from '../explorer/file-operations';
import { isSameOrInside, stemSelection, validateEntryName } from '../explorer/file-names';
import {
  addSolutionFolder,
  addSolutionItem,
  folderAndDescendants,
  removeSolutionFolder,
  removeSolutionItem,
  renameSolutionFolder,
  solutionFolderPath,
  validateSolutionFolderName,
} from '../solution/solution-folder-writer';
import { ExplorerNode } from '../explorer/solution-tree-item';
import {
  assignProject,
  setStartupProject,
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

/** Removes projects from the solution with the dotnet CLI and forgets their layout entries. */
async function removeProjectsFromSolution(ctx: CommandContext, projects: readonly SolutionProject[]): Promise<void> {
  const { model } = requireSolution(ctx);
  for (const p of projects) await ctx.runner.exec(removeProjectFromSolutionArgs(model.path, p.absolutePath), model.directory);
  const keys = new Set(projects.map(p => p.key));
  await ctx.manager.updateLayout(l => {
    let next = [...keys].reduce((acc, k) => assignProject(acc, k, undefined), l);
    if (next.startupProject && keys.has(next.startupProject)) next = setStartupProject(next, undefined);
    return next;
  });
}

interface SolutionItemRef { readonly folderId: string; readonly filePath: string }

function solutionItemsOf(ctx: CommandContext, node: unknown, selected: unknown): SolutionItemRef[] {
  const clicked = (node as ExplorerNode | undefined) ?? ctx.provider.selection[0];
  let nodes = Array.isArray(selected) ? (selected as ExplorerNode[]) : clicked ? [clicked] : [];
  if (clicked && !nodes.includes(clicked)) nodes = [clicked];
  return nodes.flatMap(n => (n.type === 'structure' && n.node.kind === 'solutionItem' ? [{ folderId: n.node.folderId, filePath: n.node.filePath }] : []));
}

const itemPath = (model: SolutionModel, filePath: string) => normalizeRelativePath(path.relative(model.directory, filePath));

/** Applies solution-item edits to the solution file in one write. */
async function editSolutionText(ctx: CommandContext, edit: (text: string, model: SolutionModel) => string): Promise<void> {
  const { model } = requireSolution(ctx);
  const text = await fs.readFile(model.path, 'utf8');
  await fs.writeFile(model.path, edit(text, model), 'utf8');
  await ctx.manager.reload();
}

/** Re-lists solution items under another solution folder (files stay where they are, as in Visual Studio). */
async function moveSolutionItems(ctx: CommandContext, items: readonly SolutionItemRef[], targetFolderId: string): Promise<void> {
  const moving = items.filter(i => i.folderId !== targetFolderId);
  if (!moving.length) return;
  const target = requireSolution(ctx).model.folders.find(f => f.id === targetFolderId);
  const already = moving.find(i => target?.files.some(f => path.resolve(f) === path.resolve(i.filePath)));
  if (already) throw new UserFacingError(`${path.basename(already.filePath)} is already listed in "${target!.name}".`);
  await editSolutionText(ctx, (text, model) => moving.reduce((t, i) => {
    const rel = itemPath(model, i.filePath);
    return addSolutionItem(model.format, removeSolutionItem(model.format, t, model, i.folderId, rel), model, targetFolderId, rel, true);
  }, text));
}

export function registerFolderCommands(ctx: CommandContext): void {
  registerCommand(ctx, 'codestudio.renameSolutionItem', 'Rename Solution Item', async (node?: unknown) => {
    const [item] = solutionItemsOf(ctx, node, undefined);
    if (!item) throw new UserFacingError('Select a solution item to rename.');
    const oldName = path.basename(item.filePath);
    const name = (await vscode.window.showInputBox({
      title: 'Rename solution item', value: oldName, valueSelection: stemSelection(oldName, false), validateInput: validateEntryName,
    }))?.trim();
    if (!name || name === oldName) return;
    const oldUri = vscode.Uri.file(item.filePath);
    let newUri: vscode.Uri;
    try {
      newUri = await renameEntry(oldUri, name);
    } catch (err) {
      throw err instanceof FileOperationError ? new UserFacingError(err.message) : err;
    }
    try {
      await editSolutionText(ctx, (text, model) => addSolutionItem(model.format,
        removeSolutionItem(model.format, text, model, item.folderId, itemPath(model, item.filePath)), model, item.folderId, itemPath(model, newUri.fsPath), true));
    } catch (err) {
      await renameEntry(newUri, oldName).catch(() => undefined); // keep disk and solution consistent
      throw err;
    }
  });

  registerCommand(ctx, 'codestudio.removeSolutionItem', 'Remove Solution Item', async (node?: unknown, selected?: unknown) => {
    const items = solutionItemsOf(ctx, node, selected);
    if (!items.length) throw new UserFacingError('Select solution items to remove.');
    const what = items.length === 1 ? `"${path.basename(items[0].filePath)}"` : `${items.length} solution items`;
    const choice = await vscode.window.showWarningMessage(`Remove ${what} from the solution?`, {
      modal: true, detail: '"Remove" only unlists the file. "Delete" also moves it to the trash.',
    }, 'Remove', 'Delete');
    if (!choice) return;
    await editSolutionText(ctx, (text, model) => items.reduce((t, i) => removeSolutionItem(model.format, t, model, i.folderId, itemPath(model, i.filePath)), text));
    if (choice === 'Delete') await deleteEntries(items.map(i => vscode.Uri.file(i.filePath)));
  });

  registerCommand(ctx, 'codestudio.moveSolutionItem', 'Move Solution Item', async (node?: unknown, selected?: unknown, targetFolderId?: string) => {
    const items = solutionItemsOf(ctx, node, selected);
    if (!items.length) throw new UserFacingError('Select solution items to move.');
    let target = targetFolderId;
    if (target === undefined) {
      const { model } = requireSolution(ctx);
      const pick = await vscode.window.showQuickPick(
        model.folders.filter(f => !items.every(i => i.folderId === f.id))
          .map(f => ({ label: `$(folder-library) ${solutionFolderPath(model, f.id)}`, id: f.id }))
          .sort((a, b) => a.label.localeCompare(b.label)),
        { placeHolder: 'Move to which solution folder? (the file stays where it is on disk)' },
      );
      if (!pick) return;
      target = pick.id;
    }
    await moveSolutionItems(ctx, items, target);
  });

  registerCommand(ctx, 'codestudio.removeProject', 'Remove Project', async (node?: unknown) => {
    node ??= ctx.provider.selection[0]; // keybindings pass no node
    const { model } = requireSolution(ctx);
    const project = await resolveProject(ctx, node, 'Select a project to remove from the solution');
    if (!project) return;
    const projectDir = path.dirname(project.absolutePath);
    // Never offer to trash a folder that holds the solution itself (or is the solution folder).
    const canDeleteFiles = !isSameOrInside(model.directory, projectDir);
    const buttons = canDeleteFiles ? ['Remove', 'Remove and Delete Files'] : ['Remove'];
    const choice = await vscode.window.showWarningMessage(
      `Remove ${project.name} from ${model.name}?`,
      { modal: true, detail: canDeleteFiles
        ? `"Remove" keeps the files on disk. "Remove and Delete Files" also moves ${vscode.workspace.asRelativePath(projectDir)} to the trash.`
        : 'The project files stay on disk.' },
      ...buttons,
    );
    if (!choice) return;
    await removeProjectsFromSolution(ctx, [project]);
    if (choice === 'Remove and Delete Files') await deleteEntries([vscode.Uri.file(projectDir)]);
    await ctx.manager.reload();
  });

  registerCommand(ctx, 'codestudio.deleteSolutionFolder', 'Delete Solution Folder', async (node?: unknown) => {
    node ??= ctx.provider.selection[0]; // keybindings pass no node
    const { model } = requireSolution(ctx);
    const folder = solutionFolderOf(node);
    if (!folder) throw new UserFacingError('Run "Delete" on a solution folder in the Solution Explorer.');
    const ids = folderAndDescendants(model, folder.id);
    const projects = model.projects.filter(p => p.parentFolderId && ids.has(p.parentFolderId));
    const items = model.folders.filter(f => ids.has(f.id)).reduce((n, f) => n + f.files.length, 0);
    const detail = [
      ids.size > 1 ? `${ids.size - 1} sub-folder(s) are removed too.` : '',
      projects.length ? `${projects.length} project(s) are removed from the solution: ${projects.map(p => p.name).join(', ')}.` : '',
      items ? `${items} solution item(s) are no longer listed.` : '',
      'No files are deleted from disk.',
    ].filter(Boolean).join(' ');
    const confirm = await vscode.window.showWarningMessage(`Delete solution folder "${folder.name}"?`, { modal: true, detail }, 'Delete');
    if (confirm !== 'Delete') return;
    if (projects.length) await removeProjectsFromSolution(ctx, projects);
    // `dotnet sln remove` may already have dropped emptied folders; remove whatever is left.
    const text = await fs.readFile(model.path, 'utf8');
    await fs.writeFile(model.path, removeSolutionFolder(model.format, text, { ...model, projects: model.projects.filter(p => !projects.includes(p)) }, folder.id), 'utf8');
    await ctx.manager.reload();
  });

  registerCommand(ctx, 'codestudio.renameSolutionFolder', 'Rename Solution Folder', async (node?: unknown) => {
    node ??= ctx.provider.selection[0]; // keybindings pass no node
    const { model } = requireSolution(ctx);
    const folder = solutionFolderOf(node);
    if (!folder) throw new UserFacingError('Run "Rename" on a solution folder in the Solution Explorer.');
    const others = { ...model, folders: model.folders.filter(f => f.id !== folder.id) };
    const name = await vscode.window.showInputBox({
      title: `Rename solution folder "${folder.name}"`,
      value: folder.name,
      validateInput: v => validateSolutionFolderName(others, v, folder.parentFolderId),
    });
    if (name === undefined || name.trim() === folder.name) return;
    const text = await fs.readFile(model.path, 'utf8');
    await fs.writeFile(model.path, renameSolutionFolder(model.format, text, model, folder.id, name), 'utf8');
    await ctx.manager.reload();
  });

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
