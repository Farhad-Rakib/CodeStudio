import * as path from 'path';
import * as vscode from 'vscode';
import { PackageReference, ProjectInfo, ProjectReference } from '../solution/project-reader';
import { SolutionModel, SolutionProject } from '../solution/solution-model';
import { isSdkStyleSqlProject } from '../sql/sql-project';
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
  /** The .dacpac a SQL database project builds for the active configuration. */
  | { readonly type: 'buildOutput'; readonly project: SolutionProject; readonly uri: vscode.Uri; readonly configuration: string; readonly exists: boolean }
  | { readonly type: 'message'; readonly id: string; readonly text: string; readonly icon: string };

// Colors contributed in package.json (`contributes.colors`): themes can define them and users can
// override them per theme via `workbench.colorCustomizations`.
const color = (id: string) => new vscode.ThemeColor(`codestudio.${id}`);
const c = {
  solution: color('solutionIcon'),
  solutionFolder: color('solutionFolderIcon'),
  virtualFolder: color('virtualFolderIcon'),
  csharp: color('csharpProjectIcon'),
  fsharp: color('fsharpProjectIcon'),
  vb: color('vbProjectIcon'),
  web: color('webProjectIcon'),
  test: color('testProjectIcon'),
  package: color('packageIcon'),
  dependency: color('dependencyIcon'),
  error: color('errorIcon'),
  sql: color('sqlProjectIcon'),
};

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
    case 'buildOutput': return `out:${node.project.key}`;
    case 'message': return `msg:${node.id}`;
  }
}

export function projectIcon(project: SolutionProject, info: ProjectInfo | undefined): vscode.ThemeIcon {
  if (info?.isTestProject) return new vscode.ThemeIcon('beaker', c.test);
  if (info?.sdk?.toLowerCase().includes('web')) return new vscode.ThemeIcon('globe', c.web);
  switch (project.kind) {
    case 'csharp': return new vscode.ThemeIcon('symbol-class', c.csharp);
    case 'fsharp': return new vscode.ThemeIcon('symbol-function', c.fsharp);
    case 'vb': return new vscode.ThemeIcon('symbol-module', c.vb);
    case 'sqlproj': return new vscode.ThemeIcon('database', c.sql);
    default: return new vscode.ThemeIcon('project');
  }
}

/** e.g. "project.test.startup.assigned"; menus match on these segments (order matters for the regexes). */
export function projectContextValue(info: ProjectInfo | undefined, assigned: boolean, startup = false, sql = false): string {
  return `project${sql ? '.sql' : info?.isTestProject ? '.test' : ''}${startup ? '.startup' : ''}${assigned ? '.assigned' : ''}`;
}

export function createTreeItem(node: ExplorerNode, filterActive: boolean, info?: ProjectInfo, infoError?: string, startupKey?: string, sqlWarning?: string): vscode.TreeItem {
  const suffix = filterActive ? '#filtered' : '';
  const expandedWhenFiltered = filterActive ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
  let item: vscode.TreeItem;

  switch (node.type) {
    case 'solution': {
      const m = node.model;
      item = new vscode.TreeItem(`Solution '${m.name}'`, vscode.TreeItemCollapsibleState.Expanded);
      item.description = `(${m.projects.length} of ${m.projects.length} project${m.projects.length === 1 ? '' : 's'})`;
      item.iconPath = new vscode.ThemeIcon('layers', c.solution);
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
          item.iconPath = new vscode.ThemeIcon('folder', c.virtualFolder);
          item.description = describeFolder(s.children);
          item.tooltip = `Virtual folder "${s.label}" (CodeXStudio layout only, no files are moved)`;
          item.contextValue = 'virtualFolder';
          break;
        case 'solutionFolder':
          item = new vscode.TreeItem(s.label, s.children.length ? expandedWhenFiltered : vscode.TreeItemCollapsibleState.None);
          item.iconPath = new vscode.ThemeIcon('folder-library', c.solutionFolder);
          item.description = describeFolder(s.children);
          item.tooltip = `Solution folder "${s.label}" (defined in the solution file)`;
          item.contextValue = 'solutionFolder';
          break;
        case 'project': {
          const p = s.project;
          const isStartup = startupKey === p.key;
          // Highlighted (bold) label marks the startup project, as in Visual Studio.
          item = new vscode.TreeItem(isStartup ? { label: p.name, highlights: [[0, p.name.length]] } : p.name, vscode.TreeItemCollapsibleState.Collapsed);
          item.iconPath = infoError ? new vscode.ThemeIcon('warning', c.error) : projectIcon(p, info);
          const sql = p.kind === 'sqlproj';
          const tfm = infoError ? 'unavailable'
            : sql ? (isSdkStyleSqlProject(info?.sdk) ? 'SQL database' : 'SQL database (legacy)')
            : info?.targetFrameworks.join('; ');
          item.description = isStartup ? ['startup', tfm].filter(Boolean).join(' · ') : tfm;
          const tip = new vscode.MarkdownString();
          tip.appendMarkdown(`**${p.name}**\n\n`).appendText(p.absolutePath);
          if (info?.sdk) tip.appendMarkdown(`\n\nSDK: \`${info.sdk}\``);
          if (infoError) tip.appendMarkdown('\n\n').appendText(infoError);
          item.tooltip = tip;
          item.resourceUri = vscode.Uri.file(p.absolutePath);
          if (isStartup) tip.appendMarkdown('\n\n$(play) **Startup project**');
          tip.supportThemeIcons = true;
          if (sqlWarning) tip.appendMarkdown('\n\n$(warning) ').appendText(sqlWarning);
          item.contextValue = projectContextValue(info, s.assignedFolderId !== undefined, isStartup, sql);
          break;
        }
        case 'solutionItem':
          item = new vscode.TreeItem(vscode.Uri.file(s.filePath), vscode.TreeItemCollapsibleState.None);
          item.label = s.label;
          item.iconPath = vscode.ThemeIcon.File;
          item.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(s.filePath)] };
          // Not 'file': solution items have their own rename/remove/move commands that also edit the solution file.
          item.contextValue = 'solutionItem';
          break;
      }
      break;
    }
    case 'dependencies':
      item = new vscode.TreeItem('Dependencies', vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon('references', c.dependency);
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
      item.iconPath = new vscode.ThemeIcon(icon, node.group === 'packages' ? c.package : c.dependency);
      item.contextValue = `dependencyGroup.${node.group}`;
      break;
    }
    case 'package':
      item = new vscode.TreeItem(node.pkg.id, vscode.TreeItemCollapsibleState.None);
      item.description = node.pkg.version ? `(${node.pkg.version})` : '(central)';
      item.iconPath = new vscode.ThemeIcon('package', c.package);
      item.contextValue = 'package';
      break;
    case 'projectReference':
      item = new vscode.TreeItem(node.ref.name, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('project', c.dependency);
      item.tooltip = node.ref.absolutePath;
      item.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(node.ref.absolutePath)] };
      item.contextValue = 'projectReference';
      break;
    case 'framework':
      item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('library', c.dependency);
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
    case 'buildOutput':
      item = new vscode.TreeItem(path.basename(node.uri.fsPath), vscode.TreeItemCollapsibleState.None);
      item.resourceUri = node.uri;
      item.iconPath = new vscode.ThemeIcon('file-binary', c.sql);
      item.description = node.exists ? `bin/${node.configuration}` : `not built (${node.configuration})`;
      item.tooltip = node.exists
        ? `Build output for ${node.configuration}: ${node.uri.fsPath}`
        : `Build the project to create ${node.uri.fsPath}`;
      item.contextValue = node.exists ? 'dacpac' : 'dacpac.missing';
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
