import { promises as fs } from 'fs';
import * as path from 'path';

export interface PackageReference {
  readonly id: string;
  /** Undefined when the version is centrally managed (Directory.Packages.props) or omitted. */
  readonly version?: string;
}

export interface ProjectReference {
  readonly includePath: string;
  readonly absolutePath: string;
  readonly name: string;
}

export interface ProjectInfo {
  readonly sdk?: string;
  readonly targetFrameworks: readonly string[];
  readonly outputType?: string;
  readonly rootNamespace?: string;
  readonly packages: readonly PackageReference[];
  readonly projectReferences: readonly ProjectReference[];
  readonly frameworkReferences: readonly string[];
  readonly isTestProject: boolean;
}

const TEST_PACKAGES = [/^Microsoft\.NET\.Test\.Sdk$/i, /^xunit(\.v3)?$/i, /^NUnit$/i, /^MSTest(\.TestFramework)?$/i, /^TUnit$/i];

function attr(tagText: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tagText);
  return m ? (m[1] ?? m[2]) : undefined;
}

function element(text: string, name: string): string | undefined {
  const m = new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`, 'i').exec(text);
  return m?.[1];
}

/**
 * Lightweight, read-only extraction of the items CodeXStudio displays. This is not an
 * MSBuild evaluator: conditions, imports and Directory.Build.props are not applied.
 */
export function parseProjectXml(xml: string, projectPath: string): ProjectInfo {
  const text = xml.replace(/<!--[\s\S]*?-->/g, '');
  const projectDir = path.dirname(projectPath);

  // <Project Sdk="Name/Version">, or the <Sdk Name="..." Version="..." /> element form.
  const sdkElement = /<Sdk\b[^>]*>/i.exec(text)?.[0];
  const sdkElementName = sdkElement ? attr(sdkElement, 'Name') : undefined;
  const sdkElementVersion = sdkElement ? attr(sdkElement, 'Version') : undefined;
  const sdk = attr(/<Project\b[^>]*>/i.exec(text)?.[0] ?? '', 'Sdk')
    ?? (sdkElementName ? (sdkElementVersion ? `${sdkElementName}/${sdkElementVersion}` : sdkElementName) : undefined);
  const tfms = element(text, 'TargetFrameworks') ?? element(text, 'TargetFramework') ?? '';
  const targetFrameworks = tfms.split(';').map(s => s.trim()).filter(Boolean);
  const outputType = element(text, 'OutputType');
  const rootNamespace = element(text, 'RootNamespace') || undefined;

  const packages: PackageReference[] = [];
  for (const m of text.matchAll(/<PackageReference\b([^>]*?)(\/>|>([\s\S]*?)<\/PackageReference>)/gi)) {
    const id = attr(m[1], 'Include') ?? attr(m[1], 'Update');
    if (!id || attr(m[1], 'Include') === undefined) continue;
    const version = attr(m[1], 'Version') ?? (m[3] ? element(m[3], 'Version') : undefined);
    packages.push({ id, version });
  }

  const projectReferences: ProjectReference[] = [];
  for (const m of text.matchAll(/<ProjectReference\b([^>]*?)\/?>/gi)) {
    const include = attr(m[1], 'Include');
    if (!include) continue;
    const absolutePath = path.resolve(projectDir, ...include.replace(/\\/g, '/').split('/'));
    projectReferences.push({ includePath: include, absolutePath, name: path.basename(absolutePath, path.extname(absolutePath)) });
  }

  const frameworkReferences: string[] = [];
  for (const m of text.matchAll(/<FrameworkReference\b([^>]*?)\/?>/gi)) {
    const include = attr(m[1], 'Include');
    if (include) frameworkReferences.push(include);
  }

  const explicitTest = element(text, 'IsTestProject');
  const isTestProject = explicitTest !== undefined
    ? explicitTest.toLowerCase() === 'true'
    : packages.some(p => TEST_PACKAGES.some(re => re.test(p.id))) || /^MSTest\.Sdk/i.test(sdk ?? '');

  return { sdk, targetFrameworks, outputType, rootNamespace, packages, projectReferences, frameworkReferences, isTestProject };
}

export async function readProject(projectPath: string): Promise<ProjectInfo> {
  const xml = await fs.readFile(projectPath, 'utf8');
  return parseProjectXml(xml, projectPath);
}
