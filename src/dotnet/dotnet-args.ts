// Pure argument construction and validation for dotnet CLI invocations.
// Arguments are always passed as an argv array (never through a shell).
import * as path from 'path';
import { ANY_CPU, BuildConfiguration, isValidConfigurationName } from '../solution/build-configuration';

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

/**
 * `-c <Configuration>` plus `-p:Platform=<Platform>` for platforms other than Any CPU
 * (Any CPU is the SDK default, and projects spell it "AnyCPU", so it is never passed).
 */
export function configurationArgs(config: BuildConfiguration | undefined): string[] {
  if (!config) return [];
  if (!isValidConfigurationName(config.configuration)) throw new DotnetArgumentError(`"${config.configuration}" is not a valid build configuration.`);
  if (!isValidConfigurationName(config.platform)) throw new DotnetArgumentError(`"${config.platform}" is not a valid platform.`);
  const args = ['-c', config.configuration];
  if (config.platform.toLowerCase() !== ANY_CPU.toLowerCase()) args.push(`-p:Platform=${config.platform}`);
  return args;
}

/** dotnet build|restore|clean|test <target> [-c <Configuration>] (restore ignores the configuration) */
export function targetVerbArgs(verb: SolutionVerb, target: string, config?: BuildConfiguration): string[] {
  if (SOLUTION_EXTS.has(path.extname(target).toLowerCase())) validateSolutionPath(target);
  else validateProjectPath(target);
  if (verb === 'restore') return [verb, target];
  const args = verb === 'build' || verb === 'test' ? [verb, target, '-nologo'] : [verb, target];
  return [...args, ...configurationArgs(config)];
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

export function removeProjectFromSolutionArgs(solution: string, project: string): string[] {
  validateSolutionPath(solution);
  validateProjectPath(project);
  return ['sln', solution, 'remove', project];
}

const SOLUTION_FOLDER_PATH_RE = /^[^\\"<>|:*?\x00-\x1f]+$/;

/** dotnet sln add <project> --solution-folder <a/b>, or --in-root when no folder is given. */
export function addProjectToSolutionFolderArgs(solution: string, project: string, folderPath: string | undefined): string[] {
  const args = addProjectToSolutionArgs(solution, project);
  if (folderPath === undefined) return [...args, '--in-root'];
  if (!SOLUTION_FOLDER_PATH_RE.test(folderPath) || folderPath.split('/').some(s => s.trim() === '' || s.startsWith('-'))) {
    throw new DotnetArgumentError(`"${folderPath}" is not a valid solution folder path.`);
  }
  return [...args, '--solution-folder', folderPath];
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
export function runProjectArgs(project: string, config?: BuildConfiguration): string[] {
  validateProjectPath(project);
  return ['run', '--project', project, ...configurationArgs(config)];
}

const TFM_RE = /^net[a-z0-9.\-]{1,32}$/i;

/** dotnet msbuild <project> -getProperty:TargetPath [-p:TargetFramework=<tfm>] [-p:Configuration=..] (SDK 8+) */
export function targetPathArgs(project: string, targetFramework?: string, config?: BuildConfiguration): string[] {
  validateProjectPath(project);
  const args = ['msbuild', project, '-getProperty:TargetPath', '-nologo'];
  if (targetFramework) {
    if (!TFM_RE.test(targetFramework)) throw new DotnetArgumentError(`"${targetFramework}" is not a valid target framework.`);
    args.push(`-p:TargetFramework=${targetFramework}`);
  }
  // msbuild takes properties, not -c: Configuration=Release resolves bin/Release/... paths.
  const [, configuration, platform] = configurationArgs(config);
  if (configuration) args.push(`-p:Configuration=${configuration}`);
  if (platform) args.push(platform);
  return args;
}

const NUGET_SOURCE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.()-]{0,99}$/;

function sourceNameArg(name: string): string {
  if (!NUGET_SOURCE_NAME_RE.test(name)) throw new DotnetArgumentError(`"${name}" is not a valid package source name.`);
  return name;
}

function configFileArgs(configFile?: string): string[] {
  if (configFile === undefined) return [];
  requireAbsolute(configFile, 'NuGet config file');
  return ['--configfile', configFile];
}

function credentialArgs(username?: string, password?: string): string[] {
  if (!password) return [];
  if (/[\x00-\x1f]/.test(password) || (username && /[\x00-\x1f]/.test(username))) throw new DotnetArgumentError('Credentials cannot contain control characters.');
  // Encrypted passwords are Windows-only; clear text works on every platform.
  return ['-u', username || 'user', '-p', password, '--store-password-in-clear-text'];
}

/** dotnet nuget add source <url> -n <name> [-u -p --store-password-in-clear-text] [--configfile <file>] */
export function addNuGetSourceArgs(url: string, name: string, opts: { username?: string; password?: string; configFile?: string } = {}): string[] {
  if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new DotnetArgumentError(`"${url}" is not a valid http(s) feed URL.`);
  return ['nuget', 'add', 'source', url, '-n', sourceNameArg(name), ...credentialArgs(opts.username, opts.password), ...configFileArgs(opts.configFile)];
}

/** dotnet nuget update source <name> -u -p --store-password-in-clear-text [--configfile <file>] */
export function updateNuGetSourceCredentialsArgs(name: string, username: string | undefined, password: string, configFile?: string): string[] {
  if (!password) throw new DotnetArgumentError('A password or token is required.');
  return ['nuget', 'update', 'source', sourceNameArg(name), ...credentialArgs(username, password), ...configFileArgs(configFile)];
}

/** dotnet nuget remove|enable|disable source <name> [--configfile <file>] */
export function nugetSourceVerbArgs(verb: 'remove' | 'enable' | 'disable', name: string, configFile?: string): string[] {
  return ['nuget', verb, 'source', sourceNameArg(name), ...configFileArgs(configFile)];
}
