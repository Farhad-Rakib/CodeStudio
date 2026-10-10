// Pure C# item templates ("Add New Item"). No 'vscode' import.
import * as path from 'path';

export interface ItemTemplate {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly defaultName: string;
  render(ctx: { namespace: string; name: string }): string;
}

const CSHARP_KEYWORDS = new Set(
  ('abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern ' +
    'false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params ' +
    'private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong ' +
    'unchecked unsafe ushort using virtual void volatile while').split(' '),
);

export function validateTypeName(name: string): string | undefined {
  const t = name.trim().replace(/\.cs$/i, '');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) return 'Enter a C# identifier such as OrderService.';
  if (CSHARP_KEYWORDS.has(t)) return `"${t}" is a C# keyword.`;
  return undefined;
}

/** Turns an arbitrary folder or project name segment into a valid namespace identifier. */
export function toIdentifier(segment: string): string {
  let id = segment.replace(/[^A-Za-z0-9_]/g, '_');
  if (id === '') id = '_';
  if (/^[0-9]/.test(id)) id = `_${id}`;
  return CSHARP_KEYWORDS.has(id) ? `@${id}` : id;
}

/**
 * Namespace for a file in `targetDir`: the project's RootNamespace (or project name)
 * plus each folder below the project directory, the same convention Visual Studio uses.
 */
export function computeNamespace(projectPath: string, targetDir: string, rootNamespace?: string): string {
  const projectDir = path.dirname(projectPath);
  const base = (rootNamespace?.trim() || path.basename(projectPath, path.extname(projectPath))).split('.').map(toIdentifier);
  const rel = path.relative(projectDir, targetDir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`${targetDir} is outside the project directory.`);
  const folders = rel === '' ? [] : rel.split(path.sep).filter(Boolean).map(toIdentifier);
  return [...base, ...folders].join('.');
}

const ns = (namespace: string) => `namespace ${namespace};\n\n`;

export const ITEM_TEMPLATES: readonly ItemTemplate[] = [
  {
    id: 'class', label: 'Class', description: 'public class', defaultName: 'Class1',
    render: ({ namespace, name }) => `${ns(namespace)}public class ${name}\n{\n}\n`,
  },
  {
    id: 'interface', label: 'Interface', description: 'public interface', defaultName: 'IService',
    render: ({ namespace, name }) => `${ns(namespace)}public interface ${name}\n{\n}\n`,
  },
  {
    id: 'record', label: 'Record', description: 'public record (positional)', defaultName: 'Record1',
    render: ({ namespace, name }) => `${ns(namespace)}public record ${name}();\n`,
  },
  {
    id: 'struct', label: 'Struct', description: 'public readonly record struct', defaultName: 'Struct1',
    render: ({ namespace, name }) => `${ns(namespace)}public readonly record struct ${name}();\n`,
  },
  {
    id: 'enum', label: 'Enum', description: 'public enum', defaultName: 'Enum1',
    render: ({ namespace, name }) => `${ns(namespace)}public enum ${name}\n{\n}\n`,
  },
  {
    id: 'static-class', label: 'Static Class', description: 'public static class (helpers, extension methods)', defaultName: 'Extensions',
    render: ({ namespace, name }) => `${ns(namespace)}public static class ${name}\n{\n}\n`,
  },
  {
    id: 'abstract-class', label: 'Abstract Class', description: 'public abstract class', defaultName: 'BaseClass',
    render: ({ namespace, name }) => `${ns(namespace)}public abstract class ${name}\n{\n}\n`,
  },
  {
    id: 'exception', label: 'Exception', description: 'custom exception with standard constructors', defaultName: 'CustomException',
    render: ({ namespace, name }) =>
      `${ns(namespace)}public class ${name} : Exception\n{\n    public ${name}()\n    {\n    }\n\n` +
      `    public ${name}(string message)\n        : base(message)\n    {\n    }\n\n` +
      `    public ${name}(string message, Exception innerException)\n        : base(message, innerException)\n    {\n    }\n}\n`,
  },
  {
    id: 'api-controller', label: 'API Controller', description: 'ASP.NET Core [ApiController]', defaultName: 'ValuesController',
    render: ({ namespace, name }) => {
      const route = name.replace(/Controller$/, '').toLowerCase() || 'values';
      return `using Microsoft.AspNetCore.Mvc;\n\n${ns(namespace)}[ApiController]\n[Route("api/${route}")]\npublic class ${name} : ControllerBase\n{\n` +
        `    [HttpGet]\n    public IActionResult Get()\n    {\n        return Ok();\n    }\n}\n`;
    },
  },
  {
    id: 'minimal-api', label: 'Minimal API Endpoints', description: 'static endpoint-mapping extension method', defaultName: 'OrderEndpoints',
    render: ({ namespace, name }) => {
      const group = name.replace(/Endpoints$/, '').toLowerCase() || 'items';
      return `${ns(namespace)}public static class ${name}\n{\n    public static IEndpointRouteBuilder Map${name}(this IEndpointRouteBuilder app)\n    {\n` +
        `        var group = app.MapGroup("/api/${group}");\n\n        group.MapGet("/", () => Results.Ok());\n\n        return app;\n    }\n}\n`;
    },
  },
  {
    id: 'background-service', label: 'Background Service', description: 'hosted BackgroundService', defaultName: 'Worker',
    render: ({ namespace, name }) =>
      `using Microsoft.Extensions.Hosting;\nusing Microsoft.Extensions.Logging;\n\n${ns(namespace)}public class ${name}(ILogger<${name}> logger) : BackgroundService\n{\n` +
      `    protected override async Task ExecuteAsync(CancellationToken stoppingToken)\n    {\n        while (!stoppingToken.IsCancellationRequested)\n        {\n` +
      `            logger.LogInformation("${name} running at {Time}", DateTimeOffset.Now);\n            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);\n        }\n    }\n}\n`,
  },
  {
    id: 'xunit-test', label: 'xUnit Test Class', description: 'test class with a [Fact]', defaultName: 'Class1Tests',
    render: ({ namespace, name }) =>
      `${ns(namespace)}public class ${name}\n{\n    [Fact]\n    public void Test1()\n    {\n    }\n}\n`,
  },
  {
    id: 'nunit-test', label: 'NUnit Test Class', description: 'test fixture with a [Test]', defaultName: 'Class1Tests',
    render: ({ namespace, name }) =>
      `${ns(namespace)}public class ${name}\n{\n    [Test]\n    public void Test1()\n    {\n    }\n}\n`,
  },
  {
    id: 'mstest-test', label: 'MSTest Test Class', description: '[TestClass] with a [TestMethod]', defaultName: 'Class1Tests',
    render: ({ namespace, name }) =>
      `${ns(namespace)}[TestClass]\npublic class ${name}\n{\n    [TestMethod]\n    public void Test1()\n    {\n    }\n}\n`,
  },
];

/** Puts the test template matching the project's test framework first, and web templates first for web projects. */
export function rankTemplates(info: { sdk?: string; packages: readonly { id: string }[]; isTestProject: boolean }): ItemTemplate[] {
  const has = (re: RegExp) => info.packages.some(p => re.test(p.id));
  const preferred = new Set<string>();
  if (info.isTestProject) {
    if (has(/^xunit/i)) preferred.add('xunit-test');
    if (has(/^NUnit$/i)) preferred.add('nunit-test');
    if (has(/^MSTest/i) || /MSTest/i.test(info.sdk ?? '')) preferred.add('mstest-test');
  }
  if (/web/i.test(info.sdk ?? '')) {
    preferred.add('api-controller');
    preferred.add('minimal-api');
  }
  if (/worker/i.test(info.sdk ?? '')) preferred.add('background-service');
  return [...ITEM_TEMPLATES].sort((a, b) => Number(preferred.has(b.id)) - Number(preferred.has(a.id)));
}
