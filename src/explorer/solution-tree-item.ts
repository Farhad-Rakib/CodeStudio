import * as path from 'path';
import * as vscode from 'vscode';
import { PackageReference, ProjectInfo, ProjectReference } from '../solution/project-reader';
import { SolutionModel, SolutionProject } from '../solution/solution-model';
import { countProjects, StructureNode } from './tree-builder';

export type DependencyGroup = 'packages' | 'projects' | 'frameworks';

/** Every node shown in the Solution Explorer. */
export type ExplorerNode =
  | { readonly type: 'solution'; readonly model: SolutionModel }
  | { readonly type: 'structure'; readonly node: StructureNode }
  | { readonly type: 'dependencies'; readonly project: SolutionProject }
  | { readonly type: 'dependencyGroup'; readonly project: SolutionProject; readonly group: DependencyGroup }
  | { readonly type: 'package'; readonly project: SolutionProject; readonly pkg: PackageReference }
  | { readonly type: 'projectReference'; readonly project: SolutionProject; readonly ref: ProjectReference }
  | { readonly type: 'framework'; readonly project: SolutionProject; readonly name: string }
  | { readonly type: 'physicalFolder'; readonly project: SolutionProject; readonly uri: vscode.Uri }
  | { readonly type: 'file'; readonly uri: vscode.Uri; readonly scope: string }
  | { readonly type: 'message'; readonly id: string; readonly text: string; readonly icon: string };

const yellow = new vscode.ThemeColor('charts.yellow');
const green = new vscode.ThemeColor('charts.green');
const purple = new vscode.ThemeColor('charts.purple');
const blue = new vscode.ThemeColor('charts.blue');
const red = new vscode.ThemeColor('errorForeground');

/** Stable, unique id for every node (suffix distinguishes filtered views so they auto-expand). */
export function explorerNodeId(node: ExplorerNode, suffix = ''): string {
  switch (node.type) {
    case 'solution': return `solution:${node.model.path}${suffix}`;
    case 'structure': return `${node.node.id}${suffix}`;
    case 'dependencies': return `deps:${node.project.key}`;
    case 'dependencyGroup': return `deps:${node.project.key}:${node.group}`;
    case 'package': return `pkg:${node.project.key}:${node.pkg.id}`;
    case 'projectReference': return `pref:${node.project.key}:${node.ref.absolutePath}`;
    case 'framework': return `fwk:${node.project.key}:${node.name}`;
    case 'physicalFolder': return `dir:${node.project.key}:${node.uri.fsPath}`;
    case 'file': return `file:${node.scope}:${node.uri.fsPath}`;
    case 'message': return `msg:${node.id}`;
  }
}

export function projectIcon(project: SolutionProject, info: ProjectInfo | undefined): vscode.ThemeIcon {
  if (info?.isTestProject) return new vscode.ThemeIcon('beaker', purple);
  if (info?.sdk?.toLowerCase().includes('web')) return new vscode.ThemeIcon('globe', blue);
  switch (project.kind) {
    case 'csharp': return new vscode.ThemeIcon('symbol-class', green);
    case 'fsharp': return new vscode.ThemeIcon('symbol-function', blue);
    case 'vb': return new vscode.ThemeIcon('symbol-module', blue);
    default: return new vscode.ThemeIcon('project');
  }
}

export function projectContextValue(info: ProjectInfo | undefined, assigned: boolean): string {
  return `project${info?.isTestProject ? '.test' : ''}${assigned ? '.assigned' : ''}`;
}

export function createTreeItem(node: ExplorerNode, filterActive: boolean, info?: ProjectInfo, infoError?: string): vscode.TreeItem {
  const suffix = filterActive ? '#filtered' : '';
  const expandedWhenFiltered = filterActive ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
  let item: vscode.TreeItem;

  switch (node.type) {
    case 'solution': {
      const m = node.model;
      item = new vscode.TreeItem(`Solution '${m.name}'`, vscode.TreeItemCollapsibleState.Expanded);
      item.description = `(${m.projects.length} of ${m.projects.length} project${m.projects.length === 1 ? '' : 's'})`;
      item.iconPath = new vscode.ThemeIcon('layers', purple);
      item.tooltip = m.path;
      item.resourceUri = vscode.Uri.file(m.path);
      item.contextValue = 'solution';
      break;
    }
    case 'structure': {
      const s = node.node;
      switch (s.kind) {
        case 'virtualFolder':
          item = new vscode.TreeItem(s.label, s.children.length ? expandedWhenFiltered : vscode.TreeItemCollapsibleState.None);
          item.iconPath = new vscode.ThemeIcon('folder', yellow);
          item.description = describeFolder(s.children);
          item.tooltip = `Virtual folder "${s.label}" (DotPilot layout only, no files are moved)`;
          item.contextValue = 'virtualFolder';
          break;
        case 'solutionFolder':
          item = new vscode.TreeItem(s.label, s.children.length ? expandedWhenFiltered : vscode.TreeItemCollapsibleState.None);
          item.iconPath = new vscode.ThemeIcon('folder-library', yellow);
          item.description = describeFolder(s.children);
          item.tooltip = `Solution folder "${s.label}" (defined in the solution file)`;
          item.contextValue = 'solutionFolder';
          break;
        case 'project': {
          const p = s.project;
          item = new vscode.TreeItem(p.name, vscode.TreeItemCollapsibleState.Collapsed);
          item.iconPath = infoError ? new vscode.ThemeIcon('warning', red) : projectIcon(p, info);
          item.description = infoError ? 'unavailable' : info?.targetFrameworks.join('; ');
          const tip = new vscode.MarkdownString();
          tip.appendMarkdown(`**${p.name}**\n\n`).appendText(p.absolutePath);
          if (info?.sdk) tip.appendMarkdown(`\n\nSDK: \`${info.sdk}\``);
          if (infoError) tip.appendMarkdown('\n\n').appendText(infoError);
          item.tooltip = tip;
          item.resourceUri = vscode.Uri.file(p.absolutePath);
          item.contextValue = projectContextValue(info, s.assignedFolderId !== undefined);
          break;
        }
        case 'solutionItem':
          item = new vscode.TreeItem(vscode.Uri.file(s.filePath), vscode.TreeItemCollapsibleState.None);
          item.label = s.label;
          item.iconPath = vscode.ThemeIcon.File;
          item.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(s.filePath)] };
          item.contextValue = 'file';
          break;
      }
      break;
    }
    case 'dependencies':
      item = new vscode.TreeItem('Dependencies', vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon('references');
      item.contextValue = 'dependencies';
      break;
    case 'dependencyGroup': {
      const labels: Record<DependencyGroup, [string, string]> = {
        packages: ['Packages', 'package'],
        projects: ['Projects', 'project'],
        frameworks: ['Frameworks', 'library'],
      };
      const [label, icon] = labels[node.group];
      item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon(icon);
      item.contextValue = `dependencyGroup.${node.group}`;
      break;
    }
    case 'package':
      item = new vscode.TreeItem(node.pkg.id, vscode.TreeItemCollapsibleState.None);
      item.description = node.pkg.version ? `(${node.pkg.version})` : '(central)';
      item.iconPath = new vscode.ThemeIcon('package', blue);
      item.contextValue = 'package';
      break;
    case 'projectReference':
      item = new vscode.TreeItem(node.ref.name, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('project');
      item.tooltip = node.ref.absolutePath;
      item.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(node.ref.absolutePath)] };
      item.contextValue = 'projectReference';
      break;
    case 'framework':
      item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('library');
      item.contextValue = 'framework';
      break;
    case 'physicalFolder':
      item = new vscode.TreeItem(node.uri, vscode.TreeItemCollapsibleState.Collapsed);
      item.label = path.basename(node.uri.fsPath);
      item.iconPath = vscode.ThemeIcon.Folder;
      item.contextValue = 'physicalFolder';
      break;
    case 'file':
      item = new vscode.TreeItem(node.uri, vscode.TreeItemCollapsibleState.None);
      item.label = path.basename(node.uri.fsPath);
      item.iconPath = vscode.ThemeIcon.File;
      item.command = { command: 'vscode.open', title: 'Open', arguments: [node.uri] };
      item.contextValue = 'file';
      break;
    case 'message':
      item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon(node.icon);
      item.contextValue = 'message';
      break;
  }

  item.id = explorerNodeId(node, node.type === 'solution' || node.type === 'structure' ? suffix : '');
  return item;
}

function describeFolder(children: readonly StructureNode[]): string | undefined {
  const n = countProjects(children);
  return n === 0 ? undefined : `${n} project${n === 1 ? '' : 's'}`;
}
