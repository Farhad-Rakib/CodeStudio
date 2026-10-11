import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { parseConfigurationKey } from '../solution/build-configuration';

/**
 * CodeXStudio's virtual solution layout. Virtual folders only exist in this metadata:
 * they never move files on disk and never modify the solution file.
 */
export interface VirtualFolder {
  readonly id: string;
  readonly name: string;
  /** Parent virtual folder id; undefined means the solution root. */
  readonly parentId?: string;
}

export interface SolutionLayout {
  readonly version: 1;
  readonly folders: readonly VirtualFolder[];
  /** Project key (solution-relative path) -> virtual folder id. */
  readonly assignments: Readonly<Record<string, string>>;
  /** Project key of the startup project (Run / Debug target), if one is set. */
  readonly startupProject?: string;
  /** Active build configuration as "Configuration|Platform", e.g. "Release|Any CPU". */
  readonly activeConfiguration?: string;
}

export const EMPTY_LAYOUT: SolutionLayout = Object.freeze({ version: 1, folders: [], assignments: {} });

export class LayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LayoutError';
  }
}

/**
 * Persistence boundary for virtual folders. The JSON implementation below is the
 * only one today; a future native implementation could write solution folders
 * into .sln/.slnx through a format-preserving writer.
 */
export interface LayoutStore {
  readonly location: string;
  load(): Promise<SolutionLayout>;
  save(layout: SolutionLayout): Promise<void>;
}

/** `.vscode/.codeStudio-settings` in the solution's folder (JSON). */
export function layoutPathFor(solutionPath: string): string {
  return path.join(path.dirname(solutionPath), '.vscode', '.codeStudio-settings');
}

export class JsonLayoutStore implements LayoutStore {
  readonly location: string;

  constructor(solutionPath: string) {
    this.location = layoutPathFor(solutionPath);
  }

  async load(): Promise<SolutionLayout> {
    const text = await readIfExists(this.location);
    return text === undefined ? EMPTY_LAYOUT : parseLayout(text, this.location);
  }

  async save(layout: SolutionLayout): Promise<void> {
    const normalized = validateLayout(layout, 'layout');
    await fs.mkdir(path.dirname(this.location), { recursive: true });
    // Write-then-rename so a crash never leaves a truncated layout file.
    const tmp = `${this.location}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
    await fs.rename(tmp, this.location);
  }
}

async function readIfExists(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new LayoutError(`Cannot read ${file}: ${(err as Error).message}`);
  }
}

function parseLayout(text: string, source: string): SolutionLayout {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new LayoutError(`${source} is not valid JSON: ${(err as Error).message}`);
  }
  return validateLayout(data, source);
}

export function validateLayout(data: unknown, source: string): SolutionLayout {
  const fail = (msg: string): never => { throw new LayoutError(`Invalid layout in ${source}: ${msg}`); };
  if (typeof data !== 'object' || data === null) return fail('expected an object');
  const obj = data as Record<string, unknown>;
  if (obj.version !== 1) return fail(`unsupported version ${JSON.stringify(obj.version)} (expected 1)`);
  if (!Array.isArray(obj.folders)) return fail('"folders" must be an array');
  const ids = new Set<string>();
  const folders: VirtualFolder[] = obj.folders.map((f: unknown, i: number) => {
    if (typeof f !== 'object' || f === null) return fail(`folders[${i}] must be an object`);
    const { id, name, parentId } = f as Record<string, unknown>;
    if (typeof id !== 'string' || id === '') return fail(`folders[${i}].id must be a non-empty string`);
    if (typeof name !== 'string' || name.trim() === '') return fail(`folders[${i}].name must be a non-empty string`);
    if (parentId !== undefined && typeof parentId !== 'string') return fail(`folders[${i}].parentId must be a string`);
    if (ids.has(id)) return fail(`duplicate folder id "${id}"`);
    ids.add(id);
    return parentId === undefined ? { id, name } : { id, name, parentId };
  });
  for (const f of folders) {
    if (f.parentId !== undefined && !ids.has(f.parentId)) fail(`folder "${f.name}" has unknown parent "${f.parentId}"`);
  }
  if (hasCycle(folders)) fail('folder hierarchy contains a cycle');

  const rawAssignments = obj.assignments ?? {};
  if (typeof rawAssignments !== 'object' || rawAssignments === null || Array.isArray(rawAssignments)) {
    return fail('"assignments" must be an object');
  }
  const assignments: Record<string, string> = {};
  for (const [key, folderId] of Object.entries(rawAssignments)) {
    if (typeof folderId !== 'string') return fail(`assignment for "${key}" must be a folder id string`);
    // Drop assignments to folders that no longer exist instead of failing the whole load.
    if (ids.has(folderId)) assignments[key] = folderId;
  }
  const startup = obj.startupProject;
  if (startup !== undefined && (typeof startup !== 'string' || startup === '')) return fail('"startupProject" must be a project path string');
  const active = obj.activeConfiguration;
  if (active !== undefined && (typeof active !== 'string' || !parseConfigurationKey(active))) {
    return fail('"activeConfiguration" must look like "Debug|Any CPU"');
  }
  const layout: { -readonly [K in keyof SolutionLayout]: SolutionLayout[K] } = { version: 1, folders, assignments };
  if (startup !== undefined) layout.startupProject = startup;
  if (active !== undefined) layout.activeConfiguration = active;
  return layout;
}

function hasCycle(folders: readonly VirtualFolder[]): boolean {
  const parent = new Map(folders.map(f => [f.id, f.parentId]));
  for (const f of folders) {
    const seen = new Set<string>();
    let cur: string | undefined = f.id;
    while (cur !== undefined) {
      if (seen.has(cur)) return true;
      seen.add(cur);
      cur = parent.get(cur);
    }
  }
  return false;
}

// --- Pure layout operations. Each returns a new layout and never mutates its input. ---

const INVALID_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/;

export function validateFolderName(name: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed === '') return 'Folder name cannot be empty.';
  if (trimmed.length > 128) return 'Folder name must be 128 characters or fewer.';
  if (INVALID_NAME_CHARS.test(trimmed)) return 'Folder name cannot contain \\ / : * ? " < > | or control characters.';
  if (trimmed === '.' || trimmed === '..') return 'Folder name cannot be "." or "..".';
  return undefined;
}

function requireFolder(layout: SolutionLayout, id: string): VirtualFolder {
  const folder = layout.folders.find(f => f.id === id);
  if (!folder) throw new LayoutError(`Virtual folder "${id}" does not exist.`);
  return folder;
}

function assertUniqueSiblingName(layout: SolutionLayout, parentId: string | undefined, name: string, exceptId?: string): void {
  const clash = layout.folders.some(f => f.parentId === parentId && f.id !== exceptId && f.name.toLowerCase() === name.toLowerCase());
  if (clash) throw new LayoutError(`A virtual folder named "${name}" already exists here.`);
}

export function createFolder(layout: SolutionLayout, name: string, parentId?: string, id: string = randomUUID()): { layout: SolutionLayout; folder: VirtualFolder } {
  const error = validateFolderName(name);
  if (error) throw new LayoutError(error);
  if (parentId !== undefined) requireFolder(layout, parentId);
  const trimmed = name.trim();
  assertUniqueSiblingName(layout, parentId, trimmed);
  const folder: VirtualFolder = parentId === undefined ? { id, name: trimmed } : { id, name: trimmed, parentId };
  return { layout: { ...layout, folders: [...layout.folders, folder] }, folder };
}

export function renameFolder(layout: SolutionLayout, id: string, newName: string): SolutionLayout {
  const error = validateFolderName(newName);
  if (error) throw new LayoutError(error);
  const folder = requireFolder(layout, id);
  const trimmed = newName.trim();
  assertUniqueSiblingName(layout, folder.parentId, trimmed, id);
  return { ...layout, folders: layout.folders.map(f => (f.id === id ? { ...f, name: trimmed } : f)) };
}

/** Returns the ids of a folder and all of its descendants. */
export function descendantIds(layout: SolutionLayout, id: string): Set<string> {
  const result = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of layout.folders) {
      if (f.parentId !== undefined && result.has(f.parentId) && !result.has(f.id)) {
        result.add(f.id);
        grew = true;
      }
    }
  }
  return result;
}

/**
 * Deletes a folder and its sub-folders. Projects inside are not deleted: they
 * return to their native solution location.
 */
export function deleteFolder(layout: SolutionLayout, id: string): SolutionLayout {
  requireFolder(layout, id);
  const removed = descendantIds(layout, id);
  const assignments = Object.fromEntries(Object.entries(layout.assignments).filter(([, folderId]) => !removed.has(folderId)));
  return { ...layout, folders: layout.folders.filter(f => !removed.has(f.id)), assignments };
}

export function moveFolder(layout: SolutionLayout, id: string, newParentId: string | undefined): SolutionLayout {
  const folder = requireFolder(layout, id);
  if (newParentId !== undefined) {
    requireFolder(layout, newParentId);
    if (descendantIds(layout, id).has(newParentId)) throw new LayoutError('Cannot move a folder into itself or one of its sub-folders.');
  }
  assertUniqueSiblingName(layout, newParentId, folder.name, id);
  return {
    ...layout,
    folders: layout.folders.map(f => {
      if (f.id !== id) return f;
      return newParentId === undefined ? { id: f.id, name: f.name } : { ...f, parentId: newParentId };
    }),
  };
}

/** Assigns a project to a virtual folder, or clears its assignment when folderId is undefined. */
export function assignProject(layout: SolutionLayout, projectKey: string, folderId: string | undefined): SolutionLayout {
  if (folderId !== undefined) requireFolder(layout, folderId);
  const assignments = { ...layout.assignments };
  if (folderId === undefined) delete assignments[projectKey];
  else assignments[projectKey] = folderId;
  return { ...layout, assignments };
}

/** Sets the startup project (by project key), or clears it when undefined. */
export function setStartupProject(layout: SolutionLayout, projectKey: string | undefined): SolutionLayout {
  const { startupProject: _previous, ...rest } = layout;
  return projectKey === undefined ? rest : { ...rest, startupProject: projectKey };
}

/** Sets the active build configuration ("Debug|Any CPU"), or clears it when undefined. */
export function setActiveConfiguration(layout: SolutionLayout, key: string | undefined): SolutionLayout {
  if (key !== undefined && !parseConfigurationKey(key)) throw new LayoutError(`"${key}" is not a valid build configuration.`);
  const { activeConfiguration: _previous, ...rest } = layout;
  return key === undefined ? rest : { ...rest, activeConfiguration: key };
}

/** Full display path of a folder, e.g. "Backend / Services". */
export function folderPath(layout: SolutionLayout, id: string): string {
  const names: string[] = [];
  let cur = layout.folders.find(f => f.id === id);
  while (cur) {
    names.unshift(cur.name);
    cur = cur.parentId === undefined ? undefined : layout.folders.find(f => f.id === cur!.parentId);
  }
  return names.join(' / ');
}
