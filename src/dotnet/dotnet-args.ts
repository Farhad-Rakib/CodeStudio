// Pure argument construction and validation for dotnet CLI invocations.
// Arguments are always passed as an argv array (never through a shell).
import * as path from 'path';

export class DotnetArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DotnetArgumentError';
  }
}

export type SolutionVerb = 'build' | 'restore' | 'clean' | 'test';

const SOLUTION_EXTS = new Set(['.sln', '.slnx']);
const PROJECT_EXTS = new Set(['.csproj', '.fsproj', '.vbproj', '.sqlproj']);
const PACKAGE_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/;
const PACKAGE_VERSION_RE = /^[0-9A-Za-z.\-+*[\](), ]{1,64}$/;

function requireAbsolute(p: string, what: string): void {
  if (!p || !path.isAbsolute(p)) throw new DotnetArgumentError(`${what} must be an absolute path (got "${p}").`);
}

export function validateSolutionPath(p: string): void {
  requireAbsolute(p, 'Solution path');
  if (!SOLUTION_EXTS.has(path.extname(p).toLowerCase())) throw new DotnetArgumentError(`"${path.basename(p)}" is not a .sln or .slnx file.`);
}

export function validateProjectPath(p: string): void {
  requireAbsolute(p, 'Project path');
  if (!PROJECT_EXTS.has(path.extname(p).toLowerCase())) {
    throw new DotnetArgumentError(`"${path.basename(p)}" is not a supported project file (.csproj, .fsproj, .vbproj, .sqlproj).`);
  }
}

export function validatePackageId(id: string): string | undefined {
  const t = id.trim();
  if (!PACKAGE_ID_RE.test(t)) return 'Package IDs contain letters, digits, ".", "-" or "_", and cannot start with "." or "-".';
  return undefined;
}

export function validatePackageVersion(version: string): string | undefined {
  const t = version.trim();
  if (t === '') return undefined;
  if (t.startsWith('-') || !PACKAGE_VERSION_RE.test(t)) return 'Enter a NuGet version such as 8.0.1, or a range such as [8.0,9.0).';
  return undefined;
}

/** dotnet build|restore|clean|test <target> */
export function targetVerbArgs(verb: SolutionVerb, target: string): string[] {
  if (SOLUTION_EXTS.has(path.extname(target).toLowerCase())) validateSolutionPath(target);
  else validateProjectPath(target);
  return verb === 'build' || verb === 'test' ? [verb, target, '-nologo'] : [verb, target];
}

export function addProjectReferenceArgs(project: string, reference: string): string[] {
  validateProjectPath(project);
  validateProjectPath(reference);
  if (path.resolve(project) === path.resolve(reference)) throw new DotnetArgumentError('A project cannot reference itself.');
  return ['add', project, 'reference', reference];
}

export function addPackageArgs(project: string, packageId: string, version?: string): string[] {
  validateProjectPath(project);
  const idError = validatePackageId(packageId);
  if (idError) throw new DotnetArgumentError(idError);
  const args = ['add', project, 'package', packageId.trim()];
  if (version !== undefined && version.trim() !== '') {
    const vError = validatePackageVersion(version);
    if (vError) throw new DotnetArgumentError(vError);
    args.push('--version', version.trim());
  }
  return args;
}

export function removePackageArgs(project: string, packageId: string): string[] {
  validateProjectPath(project);
  const idError = validatePackageId(packageId);
  if (idError) throw new DotnetArgumentError(idError);
  return ['remove', project, 'package', packageId.trim()];
}

export function addProjectToSolutionArgs(solution: string, project: string): string[] {
  validateSolutionPath(solution);
  validateProjectPath(project);
  return ['sln', solution, 'add', project];
}

const TEMPLATE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const PROJECT_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/** dotnet new <template> -n <name> -o <outputDir> */
export function newProjectArgs(template: string, name: string, outputDir: string): string[] {
  if (!TEMPLATE_RE.test(template)) throw new DotnetArgumentError(`"${template}" is not a valid template short name.`);
  if (!PROJECT_NAME_RE.test(name)) throw new DotnetArgumentError(`"${name}" is not a valid project name.`);
  requireAbsolute(outputDir, 'Output directory');
  return ['new', template, '-n', name, '-o', outputDir];
}

/** dotnet run --project <project> (uses launchSettings.json profiles when present) */
export function runProjectArgs(project: string): string[] {
  validateProjectPath(project);
  return ['run', '--project', project];
}

const TFM_RE = /^net[a-z0-9.\-]{1,32}$/i;

/** dotnet msbuild <project> -getProperty:TargetPath [-p:TargetFramework=<tfm>] (SDK 8+) */
export function targetPathArgs(project: string, targetFramework?: string): string[] {
  validateProjectPath(project);
  const args = ['msbuild', project, '-getProperty:TargetPath', '-nologo'];
  if (targetFramework) {
    if (!TFM_RE.test(targetFramework)) throw new DotnetArgumentError(`"${targetFramework}" is not a valid target framework.`);
    args.push(`-p:TargetFramework=${targetFramework}`);
  }
  return args;
}
