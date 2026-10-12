// Pure text edits that add a native solution folder to .sln / .slnx files.
// This is the one place CodeXStudio writes solution text itself: the dotnet CLI cannot
// create an empty solution folder. Edits are minimal insertions; existing lines are kept verbatim.
import { SOLUTION_FOLDER_TYPE_GUID } from './solution-reader';
import { SolutionFolder, SolutionFormat, SolutionModel } from './solution-model';

const INVALID_NAME_RE = /[\/\\"<>|:*?\x00-\x1f]/;

/** Returns an error message, or undefined when `name` is a valid new folder name under `parentId`. */
export function validateSolutionFolderName(model: SolutionModel, name: string, parentId: string | undefined): string | undefined {
  const t = name.trim();
  if (t === '') return 'Enter a folder name.';
  if (t.length > 100) return 'Folder names are limited to 100 characters.';
  if (INVALID_NAME_RE.test(t)) return 'Folder names cannot contain / \\ " < > | : * ? or control characters.';
  if (t === '.' || t === '..') return 'Enter a folder name.';
  if (model.folders.some(f => f.parentFolderId === parentId && f.name.toLowerCase() === t.toLowerCase())) {
    return `A solution folder named "${t}" already exists here.`;
  }
  return undefined;
}

/** "src/Services" for a nested folder: the path `dotnet sln add --solution-folder` expects. */
export function solutionFolderPath(model: SolutionModel, folderId: string): string {
  const byId = new Map<string, SolutionFolder>(model.folders.map(f => [f.id, f]));
  const names: string[] = [];
  const seen = new Set<string>();
  for (let f = byId.get(folderId); f && !seen.has(f.id); f = f.parentFolderId ? byId.get(f.parentFolderId) : undefined) {
    seen.add(f.id);
    names.unshift(f.name);
  }
  return names.join('/');
}

/** Returns the solution text with a new folder added. `newGuid` is only used for .sln. */
export function addSolutionFolder(format: SolutionFormat, text: string, model: SolutionModel, name: string, parentId: string | undefined, newGuid: string): string {
  const error = validateSolutionFolderName(model, name, parentId);
  if (error) throw new Error(error);
  if (parentId !== undefined && !model.folders.some(f => f.id === parentId)) throw new Error('The parent solution folder no longer exists.');
  return format === 'sln'
    ? addToSln(text, name.trim(), parentId, newGuid.toUpperCase())
    : addToSlnx(text, name.trim(), parentId);
}

function addToSln(text: string, name: string, parentGuid: string | undefined, guid: string): string {
  if (!/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(guid)) throw new Error(`Invalid GUID "${guid}".`);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const entry = [`Project("{${SOLUTION_FOLDER_TYPE_GUID}}") = "${name}", "${name}", "{${guid}}"`, 'EndProject'];

  // Projects go right before the Global block (or at the end when there is none).
  let globalIdx = lines.findIndex(l => l.trim() === 'Global');
  if (globalIdx < 0) {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    lines.push(...entry);
    globalIdx = lines.length;
    if (parentGuid) lines.push('Global', 'EndGlobal');
  } else {
    lines.splice(globalIdx, 0, ...entry);
    globalIdx += entry.length;
  }

  if (parentGuid) {
    const nestLine = `\t\t{${guid}} = {${parentGuid.toUpperCase()}}`;
    const start = lines.findIndex((l, i) => i > globalIdx && l.trim().startsWith('GlobalSection(NestedProjects)'));
    if (start >= 0) {
      const end = lines.findIndex((l, i) => i > start && l.trim() === 'EndGlobalSection');
      if (end < 0) throw new Error('Malformed solution: NestedProjects section is not closed.');
      lines.splice(end, 0, nestLine);
    } else {
      const endGlobal = lines.findIndex((l, i) => i > globalIdx && l.trim() === 'EndGlobal');
      if (endGlobal < 0) throw new Error('Malformed solution: Global block is not closed.');
      lines.splice(endGlobal, 0, '\tGlobalSection(NestedProjects) = preSolution', nestLine, '\tEndGlobalSection');
    }
  }
  return lines.join(eol);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function addToSlnx(text: string, name: string, parentPath: string | undefined): string {
  const folderPath = `${parentPath ?? '/'}${name}/`;
  const close = text.lastIndexOf('</Solution>');
  if (close < 0) throw new Error('Malformed .slnx: missing </Solution>.');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const indent = /^([ \t]+)</m.exec(text.slice(text.indexOf('<Solution')))?.[1] ?? '  ';
  const lineStart = text.lastIndexOf('\n', close - 1) + 1;
  const beforeClose = text.slice(lineStart, close);
  const element = `${indent}<Folder Name="${escapeXml(folderPath)}" />`;
  // Insert as its own line before the closing tag, keeping the closing tag's indentation.
  return beforeClose.trim() === ''
    ? `${text.slice(0, lineStart)}${element}${eol}${text.slice(lineStart)}`
    : `${text.slice(0, close)}${eol}${element}${eol}${text.slice(close)}`;
}
