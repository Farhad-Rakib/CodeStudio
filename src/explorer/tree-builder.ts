// Pure composition of the solution model and the virtual layout into a display tree.
// Kept free of 'vscode' imports so it can be unit tested.
import * as path from 'path';
import { SolutionFolder, SolutionModel, SolutionProject } from '../solution/solution-model';
import { SolutionLayout, VirtualFolder } from '../storage/layout-store';

export type StructureNode =
  | { readonly kind: 'solutionFolder'; readonly id: string; readonly label: string; readonly folder: SolutionFolder; readonly children: StructureNode[] }
  | { readonly kind: 'virtualFolder'; readonly id: string; readonly label: string; readonly folder: VirtualFolder; readonly children: StructureNode[] }
  | { readonly kind: 'project'; readonly id: string; readonly label: string; readonly project: SolutionProject; readonly assignedFolderId?: string }
  | { readonly kind: 'solutionItem'; readonly id: string; readonly label: string; readonly filePath: string };

export const nodeId = {
  solution: (p: string) => `solution:${p}`,
  solutionFolder: (id: string) => `sfolder:${id}`,
  virtualFolder: (id: string) => `vfolder:${id}`,
  project: (key: string) => `project:${key}`,
  solutionItem: (folderId: string, p: string) => `item:${folderId}:${p}`,
};

const kindOrder: Record<StructureNode['kind'], number> = { virtualFolder: 0, solutionFolder: 1, project: 2, solutionItem: 3 };

function sortNodes(nodes: StructureNode[]): StructureNode[] {
  return nodes.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

/** Builds the root-level nodes beneath the solution node. */
export function buildStructure(model: SolutionModel, layout: SolutionLayout): StructureNode[] {
  const root: StructureNode[] = [];
  const nativeChildren = new Map<string, StructureNode[]>();
  const virtualChildren = new Map<string, StructureNode[]>();

  for (const f of model.folders) nativeChildren.set(f.id, []);
  for (const f of layout.folders) virtualChildren.set(f.id, []);

  const containerFor = (map: Map<string, StructureNode[]>, parentId: string | undefined) =>
    (parentId !== undefined ? map.get(parentId) : undefined) ?? root;

  for (const f of layout.folders) {
    containerFor(virtualChildren, f.parentId).push({
      kind: 'virtualFolder', id: nodeId.virtualFolder(f.id), label: f.name, folder: f, children: virtualChildren.get(f.id)!,
    });
  }
  for (const f of model.folders) {
    const children = nativeChildren.get(f.id)!;
    for (const file of f.files) {
      children.push({ kind: 'solutionItem', id: nodeId.solutionItem(f.id, file), label: path.basename(file), filePath: file });
    }
    containerFor(nativeChildren, f.parentFolderId).push({
      kind: 'solutionFolder', id: nodeId.solutionFolder(f.id), label: f.name, folder: f, children,
    });
  }
  for (const p of model.projects) {
    const assigned = layout.assignments[p.key];
    const node: StructureNode = { kind: 'project', id: nodeId.project(p.key), label: p.name, project: p, assignedFolderId: assigned };
    if (assigned !== undefined && virtualChildren.has(assigned)) virtualChildren.get(assigned)!.push(node);
    else containerFor(nativeChildren, p.parentFolderId).push(node);
  }

  const sortDeep = (nodes: StructureNode[]) => {
    sortNodes(nodes);
    for (const n of nodes) if (n.kind === 'solutionFolder' || n.kind === 'virtualFolder') sortDeep(n.children);
  };
  sortDeep(root);
  return root;
}

/**
 * Keeps nodes whose label contains the query (case-insensitive), plus their ancestors.
 * A matching folder keeps its full subtree.
 */
export function filterStructure(nodes: readonly StructureNode[], query: string): StructureNode[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...nodes];
  const result: StructureNode[] = [];
  for (const n of nodes) {
    const matches = n.label.toLowerCase().includes(q);
    if (n.kind === 'solutionFolder' || n.kind === 'virtualFolder') {
      if (matches) {
        result.push(n);
      } else {
        const children = filterStructure(n.children, q);
        if (children.length > 0) result.push({ ...n, children });
      }
    } else if (matches) {
      result.push(n);
    }
  }
  return result;
}

/** Counts projects in a subtree, for folder descriptions. */
export function countProjects(nodes: readonly StructureNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.kind === 'project') n++;
    else if (node.kind === 'solutionFolder' || node.kind === 'virtualFolder') n += countProjects(node.children);
  }
  return n;
}
