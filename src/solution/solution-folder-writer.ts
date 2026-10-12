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

/**
 * Returns the solution text with `relativePath` (relative to the solution directory) listed as a
 * solution item of folder `folderId`, as Visual Studio's "Add > New Item" on a solution folder does.
 */
export function addSolutionItem(format: SolutionFormat, text: string, model: SolutionModel, folderId: string, relativePath: string, allowOutside = false): string {
  const folder = model.folders.find(f => f.id === folderId);
  if (!folder) throw new Error('The solution folder no longer exists.');
  const rel = relativePath.replace(/\\/g, '/');
  if (!rel || rel.startsWith('/') || /^[A-Za-z]:/.test(rel) || (!allowOutside && rel.split('/').includes('..')) || /["<>|\x00-\x1f]/.test(rel)) throw new Error(`"${relativePath}" is not a valid solution item path.`);
  return format === 'sln' ? addItemToSln(text, folderId, rel.replace(/\//g, '\\')) : addItemToSlnx(text, folderId, rel);
}

function addItemToSln(text: string, guid: string, item: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(l => l.trim().startsWith('Project(') && l.toUpperCase().includes(`"{${guid.toUpperCase()}}"`));
  if (start < 0) throw new Error('The solution folder entry was not found in the solution file.');
  const end = lines.findIndex((l, i) => i > start && l.trim() === 'EndProject');
  if (end < 0) throw new Error('Malformed solution: Project entry is not closed.');
  const entry = `\t\t${item} = ${item}`;
  const section = lines.findIndex((l, i) => i > start && i < end && l.trim().startsWith('ProjectSection(SolutionItems)'));
  if (section >= 0) {
    const sectionEnd = lines.findIndex((l, i) => i > section && i < end && l.trim() === 'EndProjectSection');
    if (sectionEnd < 0) throw new Error('Malformed solution: SolutionItems section is not closed.');
    lines.splice(sectionEnd, 0, entry);
  } else {
    lines.splice(end, 0, '\tProjectSection(SolutionItems) = preProject', entry, '\tEndProjectSection');
  }
  return lines.join(eol);
}

function addItemToSlnx(text: string, folderPath: string, item: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  for (const m of text.matchAll(/<Folder\b([^>]*?)(\/?)>/g)) {
    const name = /\bName\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(m[1]);
    if (!name || decode(name[1] ?? name[2]) !== folderPath) continue;
    const lineStart = text.lastIndexOf('\n', m.index! - 1) + 1;
    const indent = /^[ \t]*/.exec(text.slice(lineStart))![0];
    const file = `${indent}${indent || '  '}<File Path="${escapeXml(item)}" />`;
    const afterOpen = m.index! + m[0].length;
    if (m[2] === '/') {
      const open = `<Folder${m[1].replace(/\s+$/, '')}>`;
      return `${text.slice(0, m.index!)}${open}${eol}${file}${eol}${indent}</Folder>${text.slice(afterOpen)}`;
    }
    const close = text.indexOf('</Folder>', afterOpen);
    if (close < 0) throw new Error('Malformed .slnx: <Folder> is not closed.');
    const closeLineStart = text.lastIndexOf('\n', close - 1) + 1;
    return text.slice(closeLineStart, close).trim() === ''
      ? `${text.slice(0, closeLineStart)}${file}${eol}${text.slice(closeLineStart)}`
      : `${text.slice(0, close)}${eol}${file}${eol}${text.slice(close)}`;
  }
  throw new Error('The solution folder entry was not found in the solution file.');
}

/** The folder and every folder below it. */
export function folderAndDescendants(model: SolutionModel, folderId: string): Set<string> {
  const ids = new Set([folderId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const f of model.folders) if (f.parentFolderId && ids.has(f.parentFolderId) && !ids.has(f.id)) { ids.add(f.id); grew = true; }
  }
  return ids;
}

/**
 * Returns the solution text without the folder, its sub-folders and their solution items. Projects
 * inside must be removed first (with `dotnet sln remove`); folders already gone from the text are ignored.
 */
export function removeSolutionFolder(format: SolutionFormat, text: string, model: SolutionModel, folderId: string): string {
  const ids = folderAndDescendants(model, folderId);
  const remaining = model.projects.filter(p => p.parentFolderId && ids.has(p.parentFolderId));
  if (remaining.length) throw new Error(`Remove the projects in the folder first (${remaining.map(p => p.name).join(', ')}).`);
  return format === 'sln' ? removeFromSln(text, ids) : removeFromSlnx(text, ids);
}

function removeFromSln(text: string, ids: Set<string>): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const guids = new Set([...ids].map(g => g.toUpperCase()));
  const guidRe = /\{([0-9A-Fa-f-]{36})\}/g;
  const out: string[] = [];
  let skipping = false;
  let nestedStart = -1;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (skipping) {
      if (t === 'EndProject') skipping = false;
      continue;
    }
    if (t.startsWith('Project(')) {
      const own = [...t.matchAll(guidRe)].pop()?.[1].toUpperCase();
      if (own && guids.has(own)) { skipping = true; continue; }
    }
    if (t.startsWith('GlobalSection(NestedProjects)')) nestedStart = out.length;
    if (nestedStart >= 0 && t === 'EndGlobalSection') {
      if (out.length === nestedStart + 1) { out.pop(); nestedStart = -1; continue; } // drop an emptied section
      nestedStart = -1;
    }
    if (nestedStart >= 0 && out.length > nestedStart && /^\{[0-9A-Fa-f-]{36}\}\s*=\s*\{[0-9A-Fa-f-]{36}\}$/.test(t)) {
      if ([...t.matchAll(guidRe)].some(m => guids.has(m[1].toUpperCase()))) continue;
    }
    out.push(line);
  }
  return out.join(eol);
}

const decodeXml = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function removeFromSlnx(text: string, ids: Set<string>): string {
  let out = text;
  for (;;) {
    let removed = false;
    for (const m of out.matchAll(/<Folder\b([^>]*?)(\/?)>/g)) {
      const name = /\bName\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(m[1]);
      if (!name || !ids.has(decodeXml(name[1] ?? name[2]))) continue;
      let end = m.index! + m[0].length;
      if (m[2] !== '/') {
        const close = out.indexOf('</Folder>', end);
        if (close < 0) throw new Error('Malformed .slnx: <Folder> is not closed.');
        end = close + '</Folder>'.length;
      }
      // Remove the whole line(s) when the element stands alone on them.
      let start = m.index!;
      const lineStart = out.lastIndexOf('\n', start - 1) + 1;
      if (out.slice(lineStart, start).trim() === '') start = lineStart;
      const nl = /^[ \t]*\r?\n/.exec(out.slice(end));
      if (nl && start === lineStart) end += nl[0].length;
      out = out.slice(0, start) + out.slice(end);
      removed = true;
      break;
    }
    if (!removed) return out;
  }
}

/** Returns the solution text with the folder renamed (its sub-folders follow in .slnx paths). */
export function renameSolutionFolder(format: SolutionFormat, text: string, model: SolutionModel, folderId: string, newName: string): string {
  const folder = model.folders.find(f => f.id === folderId);
  if (!folder) throw new Error('The solution folder no longer exists.');
  const name = newName.trim();
  if (name === folder.name) return text;
  const siblings = { ...model, folders: model.folders.filter(f => f.id !== folderId) };
  const error = validateSolutionFolderName(siblings, name, folder.parentFolderId);
  if (error) throw new Error(error);
  if (format === 'sln') {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const i = lines.findIndex(l => l.trim().startsWith('Project(') && l.toUpperCase().includes(`"{${folderId.toUpperCase()}}"`));
    if (i < 0) throw new Error('The solution folder entry was not found in the solution file.');
    lines[i] = lines[i].replace(/=\s*"[^"]*"\s*,\s*"[^"]*"\s*,/, `= "${name}", "${name}",`);
    return lines.join(eol);
  }
  const newPath = `${folder.parentFolderId ?? '/'}${name}/`;
  return text.replace(/(<Folder\b[^>]*?\bName\s*=\s*)(?:"([^"]*)"|'([^']*)')/g, (whole, prefix: string, dq?: string, sq?: string) => {
    const current = decodeXml(dq ?? sq ?? '');
    return current.startsWith(folderId) ? `${prefix}"${escapeXml(newPath + current.slice(folderId.length))}"` : whole;
  });
}

const sameItemPath = (a: string, b: string) => a.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase() === b.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();

/** Returns the solution text without solution item `relativePath` in folder `folderId` (the file itself is untouched). */
export function removeSolutionItem(format: SolutionFormat, text: string, model: SolutionModel, folderId: string, relativePath: string): string {
  if (!model.folders.some(f => f.id === folderId)) throw new Error('The solution folder no longer exists.');
  const out = format === 'sln' ? removeItemFromSln(text, folderId, relativePath) : removeItemFromSlnx(text, folderId, relativePath);
  if (out === text) throw new Error(`"${relativePath}" is not listed in the solution folder.`);
  return out;
}

function removeItemFromSln(text: string, guid: string, item: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(l => l.trim().startsWith('Project(') && l.toUpperCase().includes(`"{${guid.toUpperCase()}}"`));
  if (start < 0) return text;
  const end = lines.findIndex((l, i) => i > start && l.trim() === 'EndProject');
  const section = lines.findIndex((l, i) => i > start && i < end && l.trim().startsWith('ProjectSection(SolutionItems)'));
  if (section < 0) return text;
  const sectionEnd = lines.findIndex((l, i) => i > section && l.trim() === 'EndProjectSection');
  const idx = lines.findIndex((l, i) => i > section && i < sectionEnd && sameItemPath(l.split('=')[0].trim(), item));
  if (idx < 0) return text;
  lines.splice(idx, 1);
  if (sectionEnd - 1 === section + 1) lines.splice(section, 2); // section is now empty
  return lines.join(eol);
}

function removeItemFromSlnx(text: string, folderPath: string, item: string): string {
  for (const m of text.matchAll(/<Folder\b([^>]*?)(\/?)>/g)) {
    const name = /\bName\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(m[1]);
    if (!name || decodeXml(name[1] ?? name[2]) !== folderPath || m[2] === '/') continue;
    const from = m.index! + m[0].length;
    const close = text.indexOf('</Folder>', from);
    if (close < 0) throw new Error('Malformed .slnx: <Folder> is not closed.');
    const re = /[ \t]*<File\b[^>]*?\bPath\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*?\/>[ \t]*(\r?\n)?/g;
    re.lastIndex = from;
    for (let f = re.exec(text); f && f.index < close; f = re.exec(text)) {
      if (sameItemPath(decodeXml(f[1] ?? f[2]), item)) return text.slice(0, f.index) + text.slice(f.index + f[0].length);
    }
  }
  return text;
}
