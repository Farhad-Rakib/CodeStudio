import * as path from 'path';

export const PROJECT_FILE_GLOB = '**/*.{csproj,fsproj,vbproj,sqlproj}';
export const PROJECT_SCAN_EXCLUDE = '**/{bin,obj,node_modules,.git,.vs,.vscode-test}/**';

/** Project files found on disk that the solution does not list, sorted by path relative to the solution directory. */
export function unlistedProjects(found: readonly string[], listed: readonly string[], solutionDir: string): { absolutePath: string; relativePath: string }[] {
  const key = (p: string) => path.resolve(p).toLowerCase();
  const known = new Set(listed.map(key));
  const seen = new Set<string>();
  const result: { absolutePath: string; relativePath: string }[] = [];
  for (const p of found) {
    const k = key(p);
    if (known.has(k) || seen.has(k)) continue;
    seen.add(k);
    result.push({ absolutePath: path.resolve(p), relativePath: path.relative(solutionDir, p).split(path.sep).join('/') });
  }
  return result.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
