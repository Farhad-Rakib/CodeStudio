import { promises as fs } from 'fs';
import * as path from 'path';
import { BuildConfiguration, DEFAULT_CONFIGURATIONS, isValidConfigurationName, parseConfigurationKey, uniqueConfigurations } from './build-configuration';
import {
  normalizeRelativePath,
  projectKindFromPath,
  SolutionFolder,
  SolutionModel,
  SolutionParseError,
  SolutionProject,
} from './solution-model';

export const SOLUTION_FOLDER_TYPE_GUID = '2150E333-8FDC-42A3-9474-1A3956D46DE8';

const HEADER_RE = /^Microsoft Visual Studio Solution File, Format Version (\d+)\.(\d+)\s*$/;
const PROJECT_RE = /^Project\("\{([0-9A-Fa-f-]{36})\}"\)\s*=\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"\{([0-9A-Fa-f-]{36})\}"\s*$/;
const NESTED_RE = /^\{([0-9A-Fa-f-]{36})\}\s*=\s*\{([0-9A-Fa-f-]{36})\}$/;
const SECTION_ITEM_RE = /^(.+?)\s*=\s*(.+)$/;

/** Reads and parses a .sln or .slnx file from disk. */
export async function readSolution(solutionPath: string): Promise<SolutionModel> {
  const ext = path.extname(solutionPath).toLowerCase();
  if (ext !== '.sln' && ext !== '.slnx') {
    throw new SolutionParseError(`Unsupported solution file type '${ext || '(none)'}'. Expected .sln or .slnx.`);
  }
  let text: string;
  try {
    text = await fs.readFile(solutionPath, 'utf8');
  } catch (err) {
    throw new SolutionParseError(`Cannot read solution file: ${(err as Error).message}`);
  }
  return ext === '.sln' ? parseSln(text, solutionPath) : parseSlnx(text, solutionPath);
}

function baseModel(solutionPath: string) {
  const directory = path.dirname(path.resolve(solutionPath));
  return { path: path.resolve(solutionPath), directory, name: path.basename(solutionPath, path.extname(solutionPath)) };
}

function toAbsolute(directory: string, relative: string): string {
  return path.resolve(directory, ...normalizeRelativePath(relative).split('/'));
}

/** Parses classic Visual Studio .sln text. */
export function parseSln(text: string, solutionPath: string): SolutionModel {
  const base = baseModel(solutionPath);
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const warnings: string[] = [];

  const firstContent = lines.findIndex(l => l.trim() !== '');
  if (firstContent < 0 || !HEADER_RE.test(lines[firstContent].trim())) {
    throw new SolutionParseError('Not a Visual Studio solution file: missing "Microsoft Visual Studio Solution File, Format Version" header.');
  }
  const major = Number(HEADER_RE.exec(lines[firstContent].trim())![1]);
  if (major < 11) {
    throw new SolutionParseError(`Solution format version ${major} is not supported (requires 11.00 or later).`);
  }

  interface RawEntry { typeGuid: string; name: string; path: string; guid: string; items: string[] }
  const entries: RawEntry[] = [];
  const nesting = new Map<string, string>();
  const configurations: BuildConfiguration[] = [];

  let current: RawEntry | undefined;
  let section: 'solutionItems' | 'nested' | 'configurations' | 'other' | undefined;

  for (let i = firstContent + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNo = i + 1;
    if (line === '' || line.startsWith('#')) continue;

    if (line.startsWith('Project(')) {
      if (current) throw new SolutionParseError('Nested Project entry; missing EndProject', lineNo);
      const m = PROJECT_RE.exec(line);
      if (!m) throw new SolutionParseError(`Malformed Project line: ${line}`, lineNo);
      current = { typeGuid: m[1].toUpperCase(), name: m[2], path: m[3], guid: m[4].toUpperCase(), items: [] };
      continue;
    }
    if (line === 'EndProject') {
      if (!current) throw new SolutionParseError('EndProject without matching Project', lineNo);
      entries.push(current);
      current = undefined;
      section = undefined;
      continue;
    }
    if (line.startsWith('ProjectSection(')) {
      section = line.startsWith('ProjectSection(SolutionItems)') ? 'solutionItems' : 'other';
      continue;
    }
    if (line === 'EndProjectSection' || line === 'EndGlobalSection') {
      section = undefined;
      continue;
    }
    if (line.startsWith('GlobalSection(')) {
      section = line.startsWith('GlobalSection(NestedProjects)') ? 'nested'
        : line.startsWith('GlobalSection(SolutionConfigurationPlatforms)') ? 'configurations'
        : 'other';
      continue;
    }
    if (line === 'Global' || line === 'EndGlobal') continue;

    if (section === 'solutionItems' && current) {
      const m = SECTION_ITEM_RE.exec(line);
      if (m) current.items.push(m[1]);
    } else if (section === 'nested') {
      const m = NESTED_RE.exec(line);
      if (!m) throw new SolutionParseError(`Malformed NestedProjects entry: ${line}`, lineNo);
      nesting.set(m[1].toUpperCase(), m[2].toUpperCase());
    } else if (section === 'configurations') {
      // "Debug|Any CPU = Debug|Any CPU": the left-hand side is the solution configuration.
      const config = parseConfigurationKey(line.split('=')[0]);
      if (config) configurations.push(config);
      else warnings.push(`Ignored unrecognized solution configuration "${line}".`);
    }
    // Other sections (project configuration mappings, properties, extensibility) are intentionally ignored.
  }
  if (current) throw new SolutionParseError(`Project "${current.name}" is missing EndProject`);

  const folderGuids = new Set(entries.filter(e => e.typeGuid === SOLUTION_FOLDER_TYPE_GUID).map(e => e.guid));
  const parentOf = (guid: string): string | undefined => {
    const parent = nesting.get(guid);
    if (parent === undefined) return undefined;
    if (!folderGuids.has(parent)) {
      warnings.push(`Nesting entry {${guid}} points to unknown solution folder {${parent}}; shown at solution root.`);
      return undefined;
    }
    return parent;
  };

  const folders: SolutionFolder[] = [];
  const projects: SolutionProject[] = [];
  for (const e of entries) {
    if (e.typeGuid === SOLUTION_FOLDER_TYPE_GUID) {
      folders.push({
        id: e.guid,
        name: e.name,
        parentFolderId: parentOf(e.guid),
        files: e.items.map(item => toAbsolute(base.directory, item)),
      });
    } else {
      const relativePath = normalizeRelativePath(e.path);
      projects.push({
        key: relativePath,
        guid: e.guid,
        name: e.name,
        relativePath,
        absolutePath: toAbsolute(base.directory, relativePath),
        kind: projectKindFromPath(relativePath),
        parentFolderId: parentOf(e.guid),
      });
    }
  }

  breakFolderCycles(folders, warnings);
  const unique = uniqueConfigurations(configurations);
  return { format: 'sln', ...base, projects, folders, configurations: unique.length ? unique : [...DEFAULT_CONFIGURATIONS], warnings };
}

/** A malformed NestedProjects section can create cycles; detach them so the tree stays finite. */
function breakFolderCycles(folders: SolutionFolder[], warnings: string[]): void {
  const byId = new Map(folders.map(f => [f.id, f]));
  for (let i = 0; i < folders.length; i++) {
    const seen = new Set<string>([folders[i].id]);
    let parent = folders[i].parentFolderId;
    while (parent !== undefined) {
      if (seen.has(parent)) {
        warnings.push(`Solution folder "${folders[i].name}" is part of a nesting cycle; shown at solution root.`);
        folders[i] = { ...folders[i], parentFolderId: undefined };
        break;
      }
      seen.add(parent);
      parent = byId.get(parent)?.parentFolderId;
    }
  }
}

// ---------------------------------------------------------------------------
// .slnx (XML solution format). Its schema is small and flat: <Solution> holds
// <Folder Name="/a/b/"> and <Project Path="..."> elements, folders hold
// <Project> and <File> elements. Anything outside that shape is rejected
// rather than guessed at.
// ---------------------------------------------------------------------------

const TAG_RE = /<(\/?)([A-Za-z_][\w.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function decodeXml(s: string): string {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, e: string) => {
    switch (e) {
      case 'lt': return '<';
      case 'gt': return '>';
      case 'amp': return '&';
      case 'quot': return '"';
      case 'apos': return "'";
      default: return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    }
  });
}

function lineAt(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** Parses the XML .slnx solution format. */
export function parseSlnx(text: string, solutionPath: string): SolutionModel {
  const base = baseModel(solutionPath);
  const src = text.replace(/^﻿/, '');
  const warnings: string[] = [];
  const folders = new Map<string, { id: string; name: string; parentFolderId?: string; files: string[] }>();
  const projects: SolutionProject[] = [];

  const ensureFolder = (folderPath: string): string => {
    if (folders.has(folderPath)) return folderPath;
    const segments = folderPath.split('/').filter(Boolean);
    const parentPath = segments.length > 1 ? `/${segments.slice(0, -1).join('/')}/` : undefined;
    if (parentPath) ensureFolder(parentPath);
    folders.set(folderPath, { id: folderPath, name: segments[segments.length - 1], parentFolderId: parentPath, files: [] });
    return folderPath;
  };

  const buildTypes: string[] = [];
  const platforms: string[] = [];
  const stack: string[] = [];
  let currentFolder: string | undefined;
  let sawRoot = false;
  let i = 0;

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      if (src.slice(i).trim() !== '') throw new SolutionParseError('Unexpected text after document end', lineAt(src, i));
      break;
    }
    if (src.slice(i, lt).trim() !== '') {
      throw new SolutionParseError('Unexpected text content in .slnx', lineAt(src, i));
    }
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt);
      if (end < 0) throw new SolutionParseError('Unterminated processing instruction', lineAt(src, lt));
      i = end + 2;
      continue;
    }
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt);
      if (end < 0) throw new SolutionParseError('Unterminated comment', lineAt(src, lt));
      i = end + 3;
      continue;
    }
    if (src.startsWith('<!', lt)) {
      throw new SolutionParseError('DOCTYPE and CDATA are not supported in .slnx files', lineAt(src, lt));
    }

    TAG_RE.lastIndex = lt;
    const m = TAG_RE.exec(src);
    if (!m) throw new SolutionParseError('Malformed XML tag', lineAt(src, lt));
    i = TAG_RE.lastIndex;
    const [, closing, tag, attrText, selfClosing] = m;
    const lineNo = lineAt(src, lt);

    if (closing) {
      if (stack.pop() !== tag) throw new SolutionParseError(`Mismatched closing tag </${tag}>`, lineNo);
      if (tag === 'Folder') currentFolder = undefined;
      continue;
    }

    const attrs: Record<string, string> = {};
    for (const a of attrText.matchAll(ATTR_RE)) attrs[a[1]] = decodeXml(a[2] ?? a[3]);
    const parent = stack[stack.length - 1];

    if (stack.length === 0) {
      if (tag !== 'Solution') throw new SolutionParseError(`Root element must be <Solution>, found <${tag}>`, lineNo);
      if (sawRoot) throw new SolutionParseError('Multiple root elements', lineNo);
      sawRoot = true;
    } else if (tag === 'Folder') {
      if (parent !== 'Solution') throw new SolutionParseError('<Folder> must be a direct child of <Solution>', lineNo);
      const name = attrs.Name;
      if (!name || !name.startsWith('/') || !name.endsWith('/') || name === '/') {
        throw new SolutionParseError(`Invalid folder Name "${name ?? ''}"; expected a path like "/src/"`, lineNo);
      }
      currentFolder = ensureFolder(name);
    } else if (tag === 'Project' && (parent === 'Solution' || parent === 'Folder')) {
      if (!attrs.Path) throw new SolutionParseError('<Project> is missing the Path attribute', lineNo);
      const relativePath = normalizeRelativePath(attrs.Path);
      const fileName = relativePath.slice(relativePath.lastIndexOf('/') + 1);
      projects.push({
        key: relativePath,
        name: attrs.DisplayName || fileName.replace(/\.[^.]+$/, ''),
        relativePath,
        absolutePath: toAbsolute(base.directory, relativePath),
        kind: projectKindFromPath(relativePath),
        parentFolderId: parent === 'Folder' ? currentFolder : undefined,
      });
    } else if (tag === 'File' && parent === 'Folder' && currentFolder) {
      if (attrs.Path) folders.get(currentFolder)!.files.push(toAbsolute(base.directory, attrs.Path));
    } else if ((tag === 'BuildType' || tag === 'Platform') && parent === 'Configurations' && attrs.Name !== undefined) {
      if (isValidConfigurationName(attrs.Name)) (tag === 'BuildType' ? buildTypes : platforms).push(attrs.Name);
      else warnings.push(`Ignored invalid ${tag} name "${attrs.Name}".`);
    }
    // Other elements (project-level BuildType/Platform mappings, Properties, ...) are ignored but must still be well-formed.

    if (!selfClosing) stack.push(tag);
  }

  if (!sawRoot) throw new SolutionParseError('Empty .slnx file: no <Solution> element');
  if (stack.length > 0) throw new SolutionParseError(`Unclosed element <${stack[stack.length - 1]}>`);

  // .slnx lists build types and platforms separately; the solution configurations are every combination.
  // Missing lists fall back to the SDK defaults (Debug, Release / Any CPU).
  const types = buildTypes.length ? buildTypes : ['Debug', 'Release'];
  const plats = platforms.length ? platforms : [DEFAULT_CONFIGURATIONS[0].platform];
  const configurations = uniqueConfigurations(types.flatMap(configuration => plats.map(platform => ({ configuration, platform }))));
  return { format: 'slnx', ...base, projects, folders: [...folders.values()], configurations, warnings };
}
