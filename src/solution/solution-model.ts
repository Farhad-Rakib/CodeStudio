// UI-independent solution data model. Nothing in src/solution may import 'vscode'.
import { BuildConfiguration } from './build-configuration';

export type SolutionFormat = 'sln' | 'slnx';

export type ProjectKind = 'csharp' | 'fsharp' | 'vb' | 'sqlproj' | 'shared' | 'other';

export interface SolutionProject {
  /** Stable key: the project path relative to the solution directory, forward slashes. */
  readonly key: string;
  /** Project GUID from a .sln file; undefined for .slnx. */
  readonly guid?: string;
  readonly name: string;
  /** Path as written in the solution file, normalized to forward slashes. */
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly kind: ProjectKind;
  /** Native solution folder containing this project, if any (SolutionFolder.id). */
  readonly parentFolderId?: string;
}

export interface SolutionFolder {
  /** GUID for .sln, folder path ("/src/tests/") for .slnx. */
  readonly id: string;
  readonly name: string;
  readonly parentFolderId?: string;
  /** Solution items (loose files) attached to this folder, absolute paths. */
  readonly files: readonly string[];
}

export interface SolutionModel {
  readonly format: SolutionFormat;
  readonly path: string;
  readonly directory: string;
  readonly name: string;
  readonly projects: readonly SolutionProject[];
  readonly folders: readonly SolutionFolder[];
  /** Solution configurations (Debug|Any CPU, ...); the SDK defaults when the file declares none. */
  readonly configurations: readonly BuildConfiguration[];
  /** Non-fatal issues found while parsing (e.g. dangling nesting entries). */
  readonly warnings: readonly string[];
}

export class SolutionParseError extends Error {
  constructor(message: string, readonly line?: number) {
    super(line !== undefined ? `${message} (line ${line})` : message);
    this.name = 'SolutionParseError';
  }
}

export function projectKindFromPath(projectPath: string): ProjectKind {
  const ext = projectPath.slice(projectPath.lastIndexOf('.')).toLowerCase();
  switch (ext) {
    case '.csproj': return 'csharp';
    case '.fsproj': return 'fsharp';
    case '.vbproj': return 'vb';
    case '.sqlproj': return 'sqlproj';
    case '.shproj': return 'shared';
    default: return 'other';
  }
}

export function normalizeRelativePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}
