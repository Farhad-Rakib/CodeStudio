import * as path from 'path';
import * as vscode from 'vscode';
import { stemSelection, validateEntryName } from '../explorer/file-names';
import { deleteEntries, FileOperationError, renameEntry, transferEntries } from '../explorer/file-operations';
import { ExplorerNode } from '../explorer/solution-tree-item';
import { CommandContext, registerCommand, UserFacingError } from './command-context';

interface Entry { readonly uri: vscode.Uri; readonly isFolder: boolean }

/** The clicked node plus the rest of the selection when it is part of a multi-selection (or the selection for keybindings). */
function entriesOf(ctx: CommandContext, node: unknown, selected: unknown): Entry[] {
  const clicked = node as ExplorerNode | undefined;
  let nodes = Array.isArray(selected) ? (selected as ExplorerNode[]) : clicked ? [clicked] : [...ctx.provider.selection];
  if (clicked && !nodes.includes(clicked)) nodes = [clicked];
  return nodes.flatMap((n): Entry[] => (n.type === 'file' ? [{ uri: n.uri, isFolder: false }] : n.type === 'physicalFolder' ? [{ uri: n.uri, isFolder: true }] : []));
}

/** Folder that receives pasted items or a new folder: a project folder, a project's directory, or a file's folder. */
function targetDirOf(ctx: CommandContext, node: unknown): vscode.Uri | undefined {
  const n = (node as ExplorerNode | undefined) ?? ctx.provider.selection[0];
  if (!n) return undefined;
  if (n.type === 'physicalFolder') return n.uri;
  if (n.type === 'file') return vscode.Uri.file(path.dirname(n.uri.fsPath));
  if (n.type === 'structure' && n.node.kind === 'project') return vscode.Uri.file(path.dirname(n.node.project.absolutePath));
  return undefined;
}

function wrap<T>(p: Promise<T>): Promise<T> {
  return p.catch(err => {
    throw err instanceof FileOperationError ? new UserFacingError(err.message) : err;
  });
}

export function registerFileCommands(ctx: CommandContext): void {
  let clipboard: { mode: 'copy' | 'move'; uris: vscode.Uri[] } | undefined;
  const setClipboard = (value: typeof clipboard) => {
    clipboard = value;
    void vscode.commands.executeCommand('setContext', 'codestudio.canPaste', !!value);
  };

  registerCommand(ctx, 'codestudio.newFolder', 'New Folder', async (node?: unknown) => {
    const dir = targetDirOf(ctx, node);
    if (!dir) throw new UserFacingError('Run "New Folder" on a project or a folder in the Solution Explorer.');
    const name = (await vscode.window.showInputBox({
      title: `New folder in ${path.basename(dir.fsPath)}`,
      value: 'NewFolder',
      validateInput: async v => validateEntryName(v)
        ?? (await vscode.workspace.fs.stat(vscode.Uri.joinPath(dir, v.trim())).then(() => 'A file or folder with this name already exists.', () => undefined)),
    }))?.trim();
    if (!name) return;
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(dir, name));
    ctx.provider.refresh();
  });

  registerCommand(ctx, 'codestudio.renameEntry', 'Rename', async (node?: unknown, selected?: unknown) => {
    const [entry] = entriesOf(ctx, node, selected);
    if (!entry) throw new UserFacingError('Select a file or folder to rename.');
    const oldName = path.basename(entry.uri.fsPath);
    const name = (await vscode.window.showInputBox({
      title: `Rename ${entry.isFolder ? 'folder' : 'file'}`,
      value: oldName,
      valueSelection: stemSelection(oldName, entry.isFolder),
      validateInput: validateEntryName,
    }))?.trim();
    if (!name || name === oldName) return;
    await wrap(renameEntry(entry.uri, name));
    ctx.provider.refresh();
  });

  registerCommand(ctx, 'codestudio.deleteEntry', 'Delete', async (node?: unknown, selected?: unknown) => {
    const entries = entriesOf(ctx, node, selected);
    if (entries.length === 0) throw new UserFacingError('Select files or folders to delete.');
    const what = entries.length === 1
      ? `"${path.basename(entries[0].uri.fsPath)}"${entries[0].isFolder ? ' and its contents' : ''}`
      : `${entries.length} items`;
    const confirm = await vscode.window.showWarningMessage(`Delete ${what}?`, { modal: true, detail: 'Items are moved to the trash when possible.' }, 'Delete');
    if (confirm !== 'Delete') return;
    await deleteEntries(entries.map(e => e.uri));
    if (clipboard) setClipboard(undefined);
    ctx.provider.refresh();
  });

  registerCommand(ctx, 'codestudio.copyEntry', 'Copy', (node?: unknown, selected?: unknown) => {
    const entries = entriesOf(ctx, node, selected);
    if (entries.length) setClipboard({ mode: 'copy', uris: entries.map(e => e.uri) });
  });

  registerCommand(ctx, 'codestudio.cutEntry', 'Cut', (node?: unknown, selected?: unknown) => {
    const entries = entriesOf(ctx, node, selected);
    if (entries.length) setClipboard({ mode: 'move', uris: entries.map(e => e.uri) });
  });

  registerCommand(ctx, 'codestudio.pasteEntry', 'Paste', async (node?: unknown) => {
    if (!clipboard) throw new UserFacingError('Nothing to paste. Copy or cut a file or folder first.');
    const dir = targetDirOf(ctx, node);
    if (!dir) throw new UserFacingError('Paste onto a project or a folder in the Solution Explorer.');
    const { mode, uris } = clipboard;
    await wrap(transferEntries(uris, dir, mode));
    // Like Visual Studio: a cut is pasted once, a copy can be pasted again.
    if (mode === 'move') setClipboard(undefined);
    ctx.provider.refresh();
  });
}
