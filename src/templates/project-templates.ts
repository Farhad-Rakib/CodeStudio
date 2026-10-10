// Pure helpers for `dotnet new` project templates. No 'vscode' import.

export interface ProjectTemplate {
  readonly name: string;
  /** First short name; what is passed to `dotnet new`. */
  readonly shortName: string;
  readonly languages: readonly string[];
  readonly tags: string;
}

/** Used when `dotnet new list` cannot be run or parsed. */
export const FALLBACK_PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  { name: 'Console App', shortName: 'console', languages: ['C#'], tags: 'Common/Console' },
  { name: 'Class Library', shortName: 'classlib', languages: ['C#'], tags: 'Common/Library' },
  { name: 'ASP.NET Core Web API', shortName: 'webapi', languages: ['C#'], tags: 'Web/Web API/API/Service' },
  { name: 'ASP.NET Core Empty', shortName: 'web', languages: ['C#'], tags: 'Web/Empty' },
  { name: 'ASP.NET Core Web App (Model-View-Controller)', shortName: 'mvc', languages: ['C#'], tags: 'Web/MVC' },
  { name: 'ASP.NET Core Web App (Razor Pages)', shortName: 'webapp', languages: ['C#'], tags: 'Web/MVC/Razor Pages' },
  { name: 'Blazor Web App', shortName: 'blazor', languages: ['C#'], tags: 'Web/Blazor' },
  { name: 'ASP.NET Core gRPC Service', shortName: 'grpc', languages: ['C#'], tags: 'Web/gRPC' },
  { name: 'Worker Service', shortName: 'worker', languages: ['C#'], tags: 'Common/Worker/Web' },
  { name: 'xUnit Test Project', shortName: 'xunit', languages: ['C#'], tags: 'Test/xUnit' },
  { name: 'NUnit Test Project', shortName: 'nunit', languages: ['C#'], tags: 'Test/NUnit' },
  { name: 'MSTest Test Project', shortName: 'mstest', languages: ['C#'], tags: 'Test/MSTest' },
];

/**
 * Parses the fixed-width table printed by `dotnet new list --type project`.
 * Column boundaries come from the dashed separator line, so localized headers are fine.
 */
export function parseTemplateList(output: string): ProjectTemplate[] {
  const lines = output.split(/\r?\n/);
  const sepIndex = lines.findIndex(l => /^-{3,}(\s+-{3,})+\s*$/.test(l));
  if (sepIndex < 0) return [];
  const columns: [number, number][] = [];
  for (const m of lines[sepIndex].matchAll(/-+/g)) columns.push([m.index!, m.index! + m[0].length]);
  if (columns.length < 3) return [];

  const cell = (line: string, i: number) => {
    const start = columns[i][0];
    const end = i + 1 < columns.length ? columns[i + 1][0] : line.length;
    return line.slice(start, end).trim();
  };
  const result: ProjectTemplate[] = [];
  for (const line of lines.slice(sepIndex + 1)) {
    if (line.trim() === '') break;
    const name = cell(line, 0);
    const shortName = cell(line, 1).split(',')[0].trim();
    if (!name || !shortName) continue;
    const languages = cell(line, 2).split(',').map(s => s.replace(/[[\]]/g, '').trim()).filter(Boolean);
    const tags = columns.length > 3 ? cell(line, 3) : '';
    result.push({ name, shortName, languages, tags });
  }
  return result;
}

const SHORT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
// Project names become folder names, assembly names and root namespaces.
const PROJECT_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

export function validateTemplateShortName(s: string): string | undefined {
  return SHORT_NAME_RE.test(s.trim()) ? undefined : 'Template short names contain letters, digits, ".", "-" or "_" (e.g. webapi).';
}

export function validateProjectName(name: string, existing: readonly string[] = []): string | undefined {
  const t = name.trim();
  if (!PROJECT_NAME_RE.test(t)) return 'Use dot-separated identifiers, e.g. Contoso.Orders.Api.';
  if (t.length > 128) return 'Project name must be 128 characters or fewer.';
  if (existing.some(e => e.toLowerCase() === t.toLowerCase())) return `A project named "${t}" is already in the solution.`;
  return undefined;
}

/** Suggests "src" for regular projects and "tests" for test templates, matching common .NET layouts. */
export function suggestedParentFolder(template: ProjectTemplate): string {
  return /(^|\/)test(\/|$)/i.test(template.tags) || /test/i.test(template.shortName) ? 'tests' : 'src';
}
