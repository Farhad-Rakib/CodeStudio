// Pure: decides whether a project can be started (Run / Debug). No 'vscode' import.
import { ProjectInfo } from '../solution/project-reader';

const APP_SDKS = /^Microsoft\.NET\.Sdk\.(Web|Worker|Razor|BlazorWebAssembly|WindowsDesktop)$/i;

/** Executables (OutputType Exe/WinExe) and web/worker SDK projects are runnable; test projects and libraries are not. */
export function isRunnable(info: ProjectInfo): boolean {
  if (info.isTestProject) return false;
  const output = info.outputType?.toLowerCase();
  if (output === 'exe' || output === 'winexe') return true;
  if (output === 'library') return false;
  return APP_SDKS.test(info.sdk ?? '') && !/Razor$/i.test(info.sdk ?? '');
}

export function isWebProject(info: ProjectInfo): boolean {
  return /^Microsoft\.NET\.Sdk\.(Web|BlazorWebAssembly)$/i.test(info.sdk ?? '');
}
