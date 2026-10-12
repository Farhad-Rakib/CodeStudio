// Copy / move / delete of physical project files, shared by the file commands and drag and drop.
// Moves and renames go through WorkspaceEdit so open editors follow the file.
import * as path from 'path';
import * as vscode from 'vscode';
import { copyName, isSameOrInside } from './file-names';

export class FileOperationError extends Error {}

async function isDirectory(uri: vscode.Uri): Promise<boolean> {
  return ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory) !== 0;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  return vscode.workspace.fs.stat(uri).then(() => true, () => false);
}

/** Drops entries whose parent folder is also in the list (copying the parent already includes them). */
function topLevel(sources: readonly vscode.Uri[]): vscode.Uri[] {
  return sources.filter(s => !sources.some(o => o.fsPath !== s.fsPath && isSameOrInside(s.fsPath, o.fsPath)));
}

/**
 * Copies or moves `sources` into `targetDir`. Copies that clash get "Name - Copy.ext"; moves that clash
 * are refused. Returns the new locations.
 */
export async function transferEntries(sources: readonly vscode.Uri[], targetDir: vscode.Uri, mode: 'copy' | 'move'): Promise<vscode.Uri[]> {
  const entries = await vscode.workspace.fs.readDirectory(targetDir);
  const taken = new Set(entries.map(([n]) => n.toLowerCase()));
  const created: vscode.Uri[] = [];
  const moves = new vscode.WorkspaceEdit();
  let moveCount = 0; // WorkspaceEdit.size does not count file renames
  for (const src of topLevel(sources)) {
    if (!(await exists(src))) throw new FileOperationError(`${path.basename(src.fsPath)} no longer exists.`);
    const folder = await isDirectory(src);
    if (folder && isSameOrInside(targetDir.fsPath, src.fsPath)) {
      throw new FileOperationError(`Cannot ${mode} folder "${path.basename(src.fsPath)}" into itself.`);
    }
    const name = path.basename(src.fsPath);
    if (mode === 'move') {
      if (path.resolve(path.dirname(src.fsPath)) === path.resolve(targetDir.fsPath)) continue;
      if (taken.has(name.toLowerCase())) throw new FileOperationError(`"${name}" already exists in ${path.basename(targetDir.fsPath)}.`);
      const dest = vscode.Uri.joinPath(targetDir, name);
      moves.renameFile(src, dest, { overwrite: false });
      moveCount++;
      taken.add(name.toLowerCase());
      created.push(dest);
    } else {
      const destName = copyName(name, folder, c => taken.has(c.toLowerCase()));
      const dest = vscode.Uri.joinPath(targetDir, destName);
      await vscode.workspace.fs.copy(src, dest, { overwrite: false });
      taken.add(destName.toLowerCase());
      created.push(dest);
    }
  }
  if (moveCount > 0 && !(await vscode.workspace.applyEdit(moves))) throw new FileOperationError('The move was cancelled or failed.');
  return created;
}

/** Renames one file or folder in place; open editors follow it. */
export async function renameEntry(uri: vscode.Uri, newName: string): Promise<vscode.Uri> {
  const dest = vscode.Uri.joinPath(vscode.Uri.file(path.dirname(uri.fsPath)), newName);
  // A case-only rename ("program.cs" -> "Program.cs") is the same file on case-insensitive disks.
  const caseOnly = dest.fsPath.toLowerCase() === uri.fsPath.toLowerCase();
  if (!caseOnly && (await exists(dest))) throw new FileOperationError(`"${newName}" already exists.`);
  const edit = new vscode.WorkspaceEdit();
  edit.renameFile(uri, dest, { overwrite: caseOnly });
  if (!(await vscode.workspace.applyEdit(edit))) throw new FileOperationError('The rename was cancelled or failed.');
  return dest;
}

/** Deletes entries, to the OS trash when possible. */
export async function deleteEntries(uris: readonly vscode.Uri[]): Promise<void> {
  for (const uri of topLevel(uris)) {
    try {
      await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true });
    } catch {
      // Some file systems have no trash; fall back to a permanent delete (the user already confirmed).
      await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
    }
  }
}
