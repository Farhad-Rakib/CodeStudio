import * as path from 'path';
import * as vscode from 'vscode';
import { Logger } from '../logger';
import { SolutionManager } from '../solution-manager';
import { ProjectInfo } from '../solution/project-reader';
import { SolutionProject } from '../solution/solution-model';
import { assignProject, LayoutError, moveFolder } from '../storage/layout-store';
import { createTreeItem, ExplorerNode } from './solution-tree-item';
import { buildStructure, filterStructure, StructureNode } from './tree-builder';

const DRAG_MIME = 'application/vnd.code.tree.dotpilot.solutionexplorer';

export class SolutionTreeProvider implements vscode.TreeDataProvider<ExplorerNode>, vscode.TreeDragAndDropController<ExplorerNode> {
  private readonly changed = new vscode.EventEmitter<ExplorerNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  readonly dragMimeTypes = [DRAG_MIME];
  readonly dropMimeTypes = [DRAG_MIME];

  private filterText = '';

  constructor(private readonly manager: SolutionManager, private readonly logger: Logger) {
    manager.onDidChange(() => this.refresh());
  }

  get filter(): string {
    return this.filterText;
  }

  setFilter(text: string): void {
    this.filterText = text.trim();
    void vscode.commands.executeCommand('setContext', 'dotpilot.filterActive', this.filterText !== '');
    this.refresh();
  }

  refresh(): void {
    this.changed.fire(undefined);
  }

  async getTreeItem(node: ExplorerNode): Promise<vscode.TreeItem> {
    if (node.type === 'structure' && node.node.kind === 'project') {
      try {
        const info = await this.manager.projectInfo(node.node.project.absolutePath);
        return createTreeItem(node, this.filterText !== '', info);
      } catch (err) {
        return createTreeItem(node, this.filterText !== '', undefined, `Cannot read project file: ${(err as Error).message}`);
      }
    }
    return createTreeItem(node, this.filterText !== '');
  }

  async getChildren(node?: ExplorerNode): Promise<ExplorerNode[]> {
    const loaded = this.manager.solution;
    if (!node) {
      if (!loaded) return [];
      const roots: ExplorerNode[] = [{ type: 'solution', model: loaded.model }];
      if (this.manager.error) {
        roots.unshift({ type: 'message', id: 'load-error', text: `Reload failed: ${this.manager.error}`, icon: 'error' });
      }
      return roots;
    }

    switch (node.type) {
      case 'solution': {
        if (!loaded) return [];
        let structure = buildStructure(loaded.model, loaded.layout);
        if (this.filterText) {
          structure = filterStructure(structure, this.filterText);
          if (structure.length === 0) return [{ type: 'message', id: 'no-match', text: `No items match "${this.filterText}"`, icon: 'search' }];
        }
        return structure.map(toNode);
      }
      case 'structure': {
        const s = node.node;
        if (s.kind === 'solutionFolder' || s.kind === 'virtualFolder') return s.children.map(toNode);
        if (s.kind === 'project') return this.projectChildren(s.project);
        return [];
      }
      case 'dependencies':
        return this.dependencyGroups(node.project);
      case 'dependencyGroup': {
        const info = await this.safeInfo(node.project);
        if (!info) return [];
        switch (node.group) {
          case 'packages': return [...info.packages].sort((a, b) => a.id.localeCompare(b.id)).map(pkg => ({ type: 'package', project: node.project, pkg }));
          case 'projects': return info.projectReferences.map(ref => ({ type: 'projectReference', project: node.project, ref }));
          case 'frameworks': return this.frameworks(info).map(name => ({ type: 'framework', project: node.project, name }));
        }
        return [];
      }
      case 'physicalFolder':
        return this.directoryChildren(node.project, node.uri);
      default:
        return [];
    }
  }

  private async safeInfo(project: SolutionProject): Promise<ProjectInfo | undefined> {
    try {
      return await this.manager.projectInfo(project.absolutePath);
    } catch (err) {
      this.logger.warn(`Cannot read ${project.absolutePath}: ${(err as Error).message}`);
      return undefined;
    }
  }

  private frameworks(info: ProjectInfo): string[] {
    const set = new Set<string>(['Microsoft.NETCore.App', ...info.frameworkReferences]);
    if (info.sdk?.toLowerCase().includes('web')) set.add('Microsoft.AspNetCore.App');
    return [...set];
  }

  private async dependencyGroups(project: SolutionProject): Promise<ExplorerNode[]> {
    const info = await this.safeInfo(project);
    if (!info) return [{ type: 'message', id: `deps-error:${project.key}`, text: 'Project file could not be read', icon: 'warning' }];
    const groups: ExplorerNode[] = [{ type: 'dependencyGroup', project, group: 'frameworks' }];
    if (info.packages.length) groups.push({ type: 'dependencyGroup', project, group: 'packages' });
    if (info.projectReferences.length) groups.push({ type: 'dependencyGroup', project, group: 'projects' });
    return groups;
  }

  private async projectChildren(project: SolutionProject): Promise<ExplorerNode[]> {
    const children: ExplorerNode[] = [{ type: 'dependencies', project }];
    if (vscode.workspace.getConfiguration('dotpilot').get<boolean>('explorer.showPhysicalFiles', true)) {
      children.push(...(await this.directoryChildren(project, vscode.Uri.file(path.dirname(project.absolutePath)))));
    }
    return children;
  }

  private async directoryChildren(project: SolutionProject, dir: vscode.Uri): Promise<ExplorerNode[]> {
    const excluded = new Set(
      (vscode.workspace.getConfiguration('dotpilot').get<string[]>('explorer.excludedFolders') ?? []).map(s => s.toLowerCase()),
    );
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch (err) {
      this.logger.warn(`Cannot list ${dir.fsPath}: ${(err as Error).message}`);
      return [{ type: 'message', id: `dir-error:${dir.fsPath}`, text: 'Folder not found on disk', icon: 'warning' }];
    }
    const folders: ExplorerNode[] = [];
    const files: ExplorerNode[] = [];
    const sorted = entries.sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    for (const [name, type] of sorted) {
      const uri = vscode.Uri.joinPath(dir, name);
      if (type & vscode.FileType.Directory) {
        if (!excluded.has(name.toLowerCase())) folders.push({ type: 'physicalFolder', project, uri });
      } else if (uri.fsPath !== project.absolutePath) {
        files.push({ type: 'file', uri, scope: project.key });
      }
    }
    return [...folders, ...files];
  }

  // --- Drag and drop: projects and virtual folders onto virtual folders or the solution root. ---

  handleDrag(source: readonly ExplorerNode[], data: vscode.DataTransfer): void {
    const draggable = source.filter(
      n => n.type === 'structure' && (n.node.kind === 'project' || n.node.kind === 'virtualFolder'),
    );
    if (draggable.length) data.set(DRAG_MIME, new vscode.DataTransferItem(draggable));
  }

  async handleDrop(target: ExplorerNode | undefined, data: vscode.DataTransfer): Promise<void> {
    const item = data.get(DRAG_MIME);
    if (!item || !this.manager.solution) return;
    const nodes = item.value as ExplorerNode[];

    let folderId: string | undefined;
    if (!target || target.type === 'solution') folderId = undefined;
    else if (target.type === 'structure' && target.node.kind === 'virtualFolder') folderId = target.node.folder.id;
    else {
      void vscode.window.showInformationMessage('DotPilot: Drop projects onto a virtual folder or the solution node. Solution folders from the .sln file are read-only.');
      return;
    }

    try {
      await this.manager.updateLayout(layout => {
        let next = layout;
        for (const n of nodes) {
          if (n.type !== 'structure') continue;
          const s: StructureNode = n.node;
          if (s.kind === 'project') next = assignProject(next, s.project.key, folderId);
          else if (s.kind === 'virtualFolder' && s.folder.id !== folderId) next = moveFolder(next, s.folder.id, folderId);
        }
        return next;
      });
    } catch (err) {
      const message = err instanceof LayoutError ? err.message : `Move failed: ${(err as Error).message}`;
      void vscode.window.showErrorMessage(`DotPilot: ${message}`);
    }
  }
}

function toNode(node: StructureNode): ExplorerNode {
  return { type: 'structure', node };
}
