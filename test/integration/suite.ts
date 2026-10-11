// Runs inside the Extension Development Host (has access to the real 'vscode' API).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { CodeXStudioApi } from '../../src/extension';
import type { ExplorerNode } from '../../src/explorer/solution-tree-item';
import type { NuGetPanel, PanelMessage } from '../../src/nuget/nuget-panel';
import { assignProject, createFolder, layoutPathFor } from '../../src/storage/layout-store';

function withTimeout<T>(p: Thenable<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms)),
  ]);
}

async function labels(api: CodeXStudioApi, node?: ExplorerNode): Promise<string[]> {
  const children = await api.provider.getChildren(node);
  return Promise.all(children.map(async c => {
    const item = await api.provider.getTreeItem(c);
    return typeof item.label === 'string' ? item.label : item.label?.label ?? '';
  }));
}

async function child(api: CodeXStudioApi, parent: ExplorerNode | undefined, label: string): Promise<ExplorerNode> {
  for (const c of await api.provider.getChildren(parent)) {
    const item = await api.provider.getTreeItem(c);
    if ((typeof item.label === 'string' ? item.label : item.label?.label) === label) return c;
  }
  throw new Error(`Node "${label}" not found; children: ${(await labels(api, parent)).join(', ')}`);
}


// --- Dialog stubs: commands call vscode.window.*; tests answer those prompts programmatically. ---
type AnyFn = (...args: any[]) => any;
const win = vscode.window as unknown as Record<string, AnyFn>;
const originals = new Map<string, AnyFn>();
function stub(name: string, impl: AnyFn): void {
  if (!originals.has(name)) originals.set(name, win[name]);
  win[name] = impl;
}
function restoreStubs(): void {
  for (const [name, fn] of originals) win[name] = fn;
  originals.clear();
}
const errors: string[] = [];
function watchErrors(): void {
  stub('showErrorMessage', async (msg: string) => { errors.push(msg); return undefined; });
}
function takeErrors(): string[] {
  return errors.splice(0);
}
const labelOf = (i: { label: string }) => i.label.replace(/^\$\([^)]+\)\s*/, '');

function execDotnet(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile('dotnet', args, { cwd }, (err, stdout, stderr) => (err ? reject(new Error(`${stdout}\n${stderr}`.trim() || err.message)) : resolve())));
}

async function projectNode(api: CodeXStudioApi, name: string): Promise<ExplorerNode> {
  const project = api.manager.solution!.model.projects.find(p => p.name === name)!;
  const [root] = await api.provider.getChildren();
  const find = async (nodes: ExplorerNode[]): Promise<ExplorerNode | undefined> => {
    for (const n of nodes) {
      if (n.type === 'structure' && n.node.kind === 'project' && n.node.project.key === project.key) return n;
      if (n.type === 'structure' && 'children' in n.node) {
        const hit = await find(await api.provider.getChildren(n));
        if (hit) return hit;
      }
    }
    return undefined;
  };
  const node = await find(await api.provider.getChildren(root));
  assert.ok(node, `${name} not in tree`);
  return node;
}

const results: { name: string; ok: boolean; error?: string }[] = [];
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    const errs = takeErrors();
    assert.deepEqual(errs, [], 'unexpected error notifications');
    results.push({ name, ok: true });
    console.log(`  ✔ ${name}`);
  } catch (err) {
    takeErrors();
    results.push({ name, ok: false, error: (err as Error).stack });
    console.log(`  ✘ ${name}\n${(err as Error).stack}`);
  }
}

export async function run(): Promise<void> {
  const workspace = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const sln = path.join(workspace, 'SampleApp.sln');
  let api!: CodeXStudioApi;
  console.log('CodeXStudio integration tests');
  watchErrors();

  await step('extension activates', async () => {
    const ext = vscode.extensions.getExtension<CodeXStudioApi>('fhasancse.codeXstudio');
    assert.ok(ext, 'extension not found');
    api = await ext.activate();
    assert.ok(ext.isActive);
  });


  await step('Solution Explorer has its own sidebar by default and can move into the Explorer; Files is never hidden', async () => {
    await api.ready;
    const config = () => vscode.workspace.getConfiguration('codestudio');
    // The test profile persists between runs; start from the shipped default.
    await config().update('defaultExplorer', undefined, vscode.ConfigurationTarget.Global);
    assert.equal(config().inspect('defaultExplorer')!.defaultValue, false, 'own sidebar by default');
    assert.equal(config().get('defaultExplorer'), false);
    // The fixture holds both SampleApp.sln and SampleApp.slnx, so nothing auto-opens; open one explicitly.
    assert.equal(api.manager.solution, undefined, 'ambiguous workspace must not auto-open');
    await vscode.commands.executeCommand('codestudio.openSolution', sln);
    await api.defaultExplorer.sync();
    assert.equal(api.defaultExplorer.activeViewId, 'codestudio.solutionExplorer');
    await vscode.commands.executeCommand('codestudio.solutionExplorer.focus');

    // Show it in the Explorer sidebar (setting, command or the view's "..." menu); the Files view stays.
    await vscode.commands.executeCommand('codestudio.makeDefaultExplorer');
    assert.equal(config().inspect('defaultExplorer')!.globalValue, true);
    assert.equal(api.defaultExplorer.activeViewId, 'codestudio.solutionExplorer.explorer');
    await vscode.commands.executeCommand('codestudio.solutionExplorer.explorer.focus');
    await vscode.commands.executeCommand('workbench.explorer.fileView.focus');
    assert.equal(api.defaultExplorer.filesViewHidden, false, 'CodeXStudio never hides the Files view');

    await vscode.commands.executeCommand('codestudio.restoreDefaultExplorer');
    assert.equal(config().inspect('defaultExplorer')!.globalValue, false);
    assert.equal(api.defaultExplorer.activeViewId, 'codestudio.solutionExplorer');
    await config().update('defaultExplorer', undefined, vscode.ConfigurationTarget.Global);
  });

  await step('all contributed commands are registered', async () => {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'));
    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = pkg.contributes.commands.map((c: { command: string }) => c.command).filter((c: string) => !registered.has(c));
    assert.deepEqual(missing, []);
  });

  await step('opens an existing .sln and shows solution folders and projects', async () => {
    await vscode.commands.executeCommand('codestudio.openSolution', sln);
    assert.equal(api.manager.solution?.model.path, sln);
    const [root] = await api.provider.getChildren();
    assert.equal(root.type, 'solution');
    assert.deepEqual(await labels(api, root), ['src', 'Tests']);
    const src = await child(api, root, 'src');
    assert.deepEqual(await labels(api, src), ['Sample.App', 'Sample.Core']);
    const app = await child(api, src, 'Sample.App');
    const appLabels = await labels(api, app);
    assert.ok(appLabels.includes('Dependencies') && appLabels.includes('Program.cs'), appLabels.join(','));
    const deps = await child(api, app, 'Dependencies');
    const projects = await child(api, deps, 'Projects');
    assert.deepEqual(await labels(api, projects), ['Sample.Core']);
    const testsItem = await api.provider.getTreeItem(await child(api, await child(api, root, 'Tests'), 'Sample.Tests'));
    assert.equal(testsItem.contextValue, 'project.test');
  });

  await step('creates and persists a virtual folder; assigning a project moves nothing on disk', async () => {
    const corePath = path.join(workspace, 'src', 'Sample.Core', 'Sample.Core.csproj');
    const slnBefore = readFileSync(sln, 'utf8');
    await api.manager.updateLayout(l => createFolder(l, 'Backend', undefined, 'it-backend').layout);
    await api.manager.updateLayout(l => assignProject(l, 'src/Sample.Core/Sample.Core.csproj', 'it-backend'));

    const [root] = await api.provider.getChildren();
    assert.deepEqual(await labels(api, root), ['Backend', 'src', 'Tests']);
    assert.deepEqual(await labels(api, await child(api, root, 'Backend')), ['Sample.Core']);
    assert.ok(existsSync(corePath), 'project file must stay in place');
    assert.equal(readFileSync(sln, 'utf8'), slnBefore, 'solution file must not change');

    const saved = JSON.parse(readFileSync(layoutPathFor(sln), 'utf8'));
    assert.equal(saved.folders[0].name, 'Backend');
    // Re-open (as after a restart) and confirm the layout is restored from disk.
    await vscode.commands.executeCommand('codestudio.openSolution', sln);
    assert.deepEqual(api.manager.solution?.layout.assignments, { 'src/Sample.Core/Sample.Core.csproj': 'it-backend' });
  });

  await step('filter keeps matching projects and their folders', async () => {
    api.provider.setFilter('tests');
    const [root] = await api.provider.getChildren();
    assert.deepEqual(await labels(api, root), ['Tests']);
    api.provider.setFilter('');
  });


  await step('drag and drop moves projects and virtual folders; read-only targets are refused', async () => {
    const before = api.manager.solution!.layout;
    await api.manager.updateLayout(l => createFolder(l, 'Apps', undefined, 'it-apps').layout);
    const [root] = await api.provider.getChildren();
    const backend = await child(api, root, 'Backend');
    const apps = await child(api, root, 'Apps');

    // Project onto a virtual folder.
    let dt = new vscode.DataTransfer();
    api.provider.handleDrag([await projectNode(api, 'Sample.App')], dt);
    await api.provider.handleDrop(apps, dt);
    assert.equal(api.manager.solution!.layout.assignments['src/Sample.App/Sample.App.csproj'], 'it-apps');

    // Virtual folder into another virtual folder.
    dt = new vscode.DataTransfer();
    api.provider.handleDrag([apps], dt);
    await api.provider.handleDrop(backend, dt);
    assert.equal(api.manager.solution!.layout.folders.find(f => f.id === 'it-apps')!.parentId, 'it-backend');

    // A folder cannot be dropped into its own descendant.
    const freshBackend = await child(api, (await api.provider.getChildren())[0], 'Backend');
    dt = new vscode.DataTransfer();
    api.provider.handleDrag([freshBackend], dt);
    await api.provider.handleDrop(await child(api, freshBackend, 'Apps'), dt);
    assert.equal(api.manager.solution!.layout.folders.find(f => f.id === 'it-backend')!.parentId, undefined);
    assert.ok(takeErrors().some(e => /into itself/.test(e)), 'cycle should be reported');

    // Native solution folder is read-only: drop is refused with a message.
    let info = '';
    stub('showInformationMessage', async (m: string) => { info = m; return undefined; });
    const layoutBefore = JSON.stringify(api.manager.solution!.layout);
    dt = new vscode.DataTransfer();
    api.provider.handleDrag([await projectNode(api, 'Sample.Tests')], dt);
    await api.provider.handleDrop(await child(api, (await api.provider.getChildren())[0], 'src'), dt);
    assert.equal(JSON.stringify(api.manager.solution!.layout), layoutBefore);
    assert.match(info, /read-only/);

    // Dropping onto the solution node returns a project to its native location.
    dt = new vscode.DataTransfer();
    api.provider.handleDrag([await projectNode(api, 'Sample.App')], dt);
    await api.provider.handleDrop((await api.provider.getChildren())[0], dt);
    assert.equal(api.manager.solution!.layout.assignments['src/Sample.App/Sample.App.csproj'], undefined);

    restoreStubs(); watchErrors();
    await api.manager.updateLayout(() => before);
  });

  await step('Restore Solution runs dotnet restore', async () => {
    await withTimeout(vscode.commands.executeCommand('codestudio.restoreSolution'), 240000, 'restore');
    for (const p of ['src/Sample.Core', 'src/Sample.App', 'tests/Sample.Tests']) {
      assert.ok(existsSync(path.join(workspace, p, 'obj', 'project.assets.json')), `${p} not restored`);
    }
  });

  await step('Build Solution runs dotnet build', async () => {
    await withTimeout(vscode.commands.executeCommand('codestudio.buildSolution'), 240000, 'build');
    const dll = path.join(workspace, 'src', 'Sample.App', 'bin', 'Debug', 'net10.0', 'Sample.App.dll');
    assert.ok(existsSync(dll), `${dll} missing`);
  });

  await step('Build configuration picker: Release is persisted and used by Build Solution', async () => {
    assert.deepEqual(api.manager.activeConfiguration, { configuration: 'Debug', platform: 'Any CPU' }, 'defaults to Debug');
    const release = api.manager.solution!.model.configurations.find(c => c.configuration === 'Release');
    assert.ok(release, 'fixture solution declares Release');
    await api.configuration.set(release);
    const stored = JSON.parse(readFileSync(layoutPathFor(sln), 'utf8'));
    assert.equal(stored.activeConfiguration, 'Release|Any CPU');
    await withTimeout(vscode.commands.executeCommand('codestudio.buildSolution'), 240000, 'release build');
    const dll = path.join(workspace, 'src', 'Sample.App', 'bin', 'Release', 'net10.0', 'Sample.App.dll');
    assert.ok(existsSync(dll), `${dll} missing`);
    await api.configuration.set({ configuration: 'Debug', platform: 'Any CPU' });
    assert.equal(api.manager.activeConfiguration?.configuration, 'Debug');
  });



  await step('Startup project: set, shown in tree, persisted, run, debug fallback, clear', async () => {
    const appNode = await projectNode(api, 'Sample.App');
    await vscode.commands.executeCommand('codestudio.setStartupProject', appNode);
    assert.equal(api.manager.solution!.layout.startupProject, 'src/Sample.App/Sample.App.csproj');
    assert.equal(JSON.parse(readFileSync(layoutPathFor(sln), 'utf8')).startupProject, 'src/Sample.App/Sample.App.csproj');
    const item = await api.provider.getTreeItem(await projectNode(api, 'Sample.App'));
    assert.match(item.contextValue!, /^project\.startup/);
    assert.match(String(item.description), /^startup/);
    assert.deepEqual((item.label as vscode.TreeItemLabel).highlights, [[0, 'Sample.App'.length]]);
    assert.equal(api.startup.startupProject?.name, 'Sample.App');
    // Icons use CodeXStudio's contributed theme colors.
    assert.equal(((item.iconPath as vscode.ThemeIcon).color as vscode.ThemeColor).id, 'codestudio.csharpProjectIcon');

    // A class library asks for confirmation; cancelling keeps the current startup project.
    stub('showWarningMessage', async () => undefined);
    await vscode.commands.executeCommand('codestudio.setStartupProject', await projectNode(api, 'Sample.Core'));
    assert.equal(api.manager.solution!.layout.startupProject, 'src/Sample.App/Sample.App.csproj');
    restoreStubs(); watchErrors();

    // Start Without Debugging runs `dotnet run` for the startup project.
    const ended = new Promise<number | undefined>(resolve => {
      const sub = vscode.tasks.onDidEndTaskProcess(e => {
        if (e.execution.task.name === 'Run: Sample.App') { sub.dispose(); resolve(e.exitCode); }
      });
    });
    const execution = await vscode.commands.executeCommand<vscode.TaskExecution>('codestudio.runStartupProject');
    assert.ok(execution, 'run task started');
    assert.deepEqual((execution.task.execution as vscode.ProcessExecution).args, ['run', '--project', path.join(workspace, 'src', 'Sample.App', 'Sample.App.csproj'), '-c', 'Debug']);
    assert.equal(await withTimeout(ended, 180000, 'dotnet run'), 0, 'console app ran and exited cleanly');

    // Without a C# extension, Start Debugging explains why and can fall back to running.
    let warning = '';
    stub('showWarningMessage', async (m: string) => { warning = m; return undefined; });
    const debugged = await vscode.commands.executeCommand('codestudio.debugStartupProject');
    assert.equal(debugged, false);
    assert.match(warning, /coreclr/);
    restoreStubs(); watchErrors();

    await vscode.commands.executeCommand('codestudio.clearStartupProject');
    assert.equal(api.manager.solution!.layout.startupProject, undefined);
    assert.match((await api.provider.getTreeItem(await projectNode(api, 'Sample.App'))).contextValue!, /^project$/);
  });

  await step('Add Project Reference dialog adds a reference via dotnet add', async () => {
    let offered: string[] = [];
    stub('showQuickPick', async (items: { label: string }[]) => {
      offered = items.map(labelOf);
      return items.filter(i => labelOf(i) === 'Sample.Core');
    });
    stub('showInformationMessage', async () => undefined);
    await vscode.commands.executeCommand('codestudio.addProjectReference', await projectNode(api, 'Sample.Tests'));
    restoreStubs(); watchErrors();
    assert.ok(!offered.includes('Sample.Tests'), 'project must not be offered to itself');
    const xml = readFileSync(path.join(workspace, 'tests', 'Sample.Tests', 'Sample.Tests.csproj'), 'utf8');
    assert.match(xml, /<ProjectReference Include="[^"]*Sample\.Core\.csproj"/);
  });

  await step('NuGet Package Manager UI: browse, details, install, updates, update all, uninstall', async () => {
    const csproj = path.join(workspace, 'src', 'Sample.Core', 'Sample.Core.csproj');
    const panel = await vscode.commands.executeCommand<NuGetPanel>('codestudio.manageNuGetPackages', await projectNode(api, 'Sample.Core'));
    assert.ok(panel, 'panel opened');
    const last = <T extends PanelMessage['type']>(type: T) => [...panel.posted].reverse().find(m => m.type === type) as Extract<PanelMessage, { type: T }> | undefined;
    stub('withProgress', async (_o: unknown, task: () => Promise<unknown>) => task());
    try {
      await panel.handleMessage({ type: 'ready' });
      assert.equal(last('project')!.project.name, 'Sample.Core');
      assert.deepEqual(last('installed')!.rows, [], 'Installed tab starts empty');
      assert.ok(last('results')!.items.length > 0, 'Browse shows popular packages');

      await panel.handleMessage({ type: 'search', query: 'Newtonsoft.Json' });
      const results = last('results')!;
      assert.equal(results.query, 'Newtonsoft.Json');
      assert.ok(results.items.some(i => i.id === 'Newtonsoft.Json'));

      await panel.handleMessage({ type: 'select', id: 'Newtonsoft.Json' });
      const details = last('details')!;
      assert.ok(details.versions.includes('13.0.1') && details.versions.length > 10, 'version picker lists versions');
      assert.equal(details.installedVersion, undefined);

      // Install an older version so the Updates tab has something to show.
      await panel.handleMessage({ type: 'install', id: 'Newtonsoft.Json', version: '13.0.1' });
      assert.match(readFileSync(csproj, 'utf8'), /<PackageReference Include="Newtonsoft.Json" Version="13.0.1"/);
      let row = last('installed')!.rows.find(r => r.id === 'Newtonsoft.Json')!;
      assert.equal(row.version, '13.0.1');
      assert.equal(row.updateAvailable, true, `update expected; latest=${row.latest}`);
      assert.equal(last('details')!.installedVersion, '13.0.1');

      // Malicious input from the webview is rejected before reaching the CLI.
      await panel.handleMessage({ type: 'install', id: '--source evil', version: '1.0.0' });
      assert.equal(last('notice')!.level, 'error');

      stub('showInformationMessage', async () => 'Update');
      await panel.handleMessage({ type: 'updateAll' });
      row = last('installed')!.rows.find(r => r.id === 'Newtonsoft.Json')!;
      assert.equal(row.updateAvailable, false);
      assert.equal(row.version, row.latest);
      assert.doesNotMatch(readFileSync(csproj, 'utf8'), /Version="13.0.1"/);

      stub('showWarningMessage', async () => 'Uninstall');
      await panel.handleMessage({ type: 'uninstall', id: 'Newtonsoft.Json' });
      assert.doesNotMatch(readFileSync(csproj, 'utf8'), /Newtonsoft/);
      assert.deepEqual(last('installed')!.rows, []);

      // Switching projects re-targets the same panel.
      await panel.handleMessage({ type: 'switchProject', key: 'tests/Sample.Tests/Sample.Tests.csproj' });
      assert.equal(last('project')!.project.name, 'Sample.Tests');
      assert.ok(last('installed')!.rows.some(r => r.id === 'xunit' || r.id.startsWith('xunit')), 'test project packages listed');
    } finally {
      panel.dispose();
      restoreStubs(); watchErrors();
    }
  });

  await step('Formatter (dotnet format and CSharpier) and C# bracket colorization defaults', async () => {
    const cs = vscode.workspace.getConfiguration('editor', { languageId: 'csharp' });
    assert.equal(cs.get('bracketPairColorization.enabled'), true);
    assert.equal(cs.get('guides.bracketPairs'), 'active');
    assert.equal(cs.get('matchBrackets'), 'always');

    const file = path.join(workspace, 'src', 'Sample.Core', 'Messy.cs');
    writeFileSync(file, 'namespace Sample.Core;\npublic class Messy{\n  public int M( int a ){\nif(a>1){return a;}\n      return 0;}\n}\n');
    const doc = await vscode.workspace.openTextDocument(file);
    try {
      assert.ok(api.formatter.registered);
      const format = async () => {
        const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatDocumentProvider', doc.uri, { tabSize: 4, insertSpaces: true });
        const we = new vscode.WorkspaceEdit();
        we.set(doc.uri, edits ?? []);
        await vscode.workspace.applyEdit(we);
        return doc.getText();
      };
      const viaDotnetFormat = await format();
      assert.match(viaDotnetFormat, /public class Messy\n\{\n    public int M\(int a\)\n    \{\n        if \(a > 1\) \{ return a; \}\n        return 0;\n    \}\n\}/);

      // CSharpier: install as a local tool through the command, then format.
      stub('showQuickPick', async (items: any[]) => items.find(i => i.scope === 'local'));
      stub('withProgress', async (_o: unknown, task: () => Promise<unknown>) => task());
      stub('showInformationMessage', async () => undefined);
      await withTimeout(vscode.commands.executeCommand('codestudio.installCSharpier'), 240000, 'install csharpier');
      assert.ok(existsSync(path.join(workspace, 'dotnet-tools.json')) || existsSync(path.join(workspace, '.config', 'dotnet-tools.json')), 'tool manifest created');
      assert.equal(vscode.workspace.getConfiguration('codestudio.formatter').get('engine'), 'csharpier');
      const viaCSharpier = await format();
      assert.match(viaCSharpier, /if \(a > 1\)\n        \{\n            return a;\n        \}/, viaCSharpier);

      // Turning the formatter off unregisters it.
      await vscode.workspace.getConfiguration('codestudio.formatter').update('enabled', false, vscode.ConfigurationTarget.Workspace);
      assert.equal(api.formatter.registered, false);
    } finally {
      for (const key of ['enabled', 'engine']) await vscode.workspace.getConfiguration('codestudio.formatter').update(key, undefined, vscode.ConfigurationTarget.Workspace);
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
      rmSync(file, { force: true });
      restoreStubs(); watchErrors();
    }
  });

  await step('Add Existing Project dialog adds a project via dotnet sln add', async () => {
    await execDotnet(['new', 'classlib', '-n', 'Sample.Extra', '-o', 'extra/Sample.Extra', '--no-restore'], workspace);
    const extra = path.join(workspace, 'extra', 'Sample.Extra', 'Sample.Extra.csproj');
    stub('showOpenDialog', async () => [vscode.Uri.file(extra)]);
    stub('showInformationMessage', async () => undefined);
    await withTimeout(vscode.commands.executeCommand('codestudio.addExistingProject'), 60000, 'add project');
    // Adding it a second time is refused with a warning, not an error.
    let warning = '';
    stub('showWarningMessage', async (m: string) => { warning = m; return undefined; });
    await vscode.commands.executeCommand('codestudio.addExistingProject');
    restoreStubs(); watchErrors();
    assert.match(warning, /already in the solution/);
    assert.ok(api.manager.solution!.model.projects.some(p => p.name === 'Sample.Extra'));
    assert.match(readFileSync(sln, 'utf8'), /Sample\.Extra\.csproj/);
  });


  await step('New Project dialog creates a webapi project from a template inside a virtual folder', async () => {
    const [root] = await api.provider.getChildren();
    const backend = await child(api, root, 'Backend');
    let quickPicks = 0;
    stub('showQuickPick', async (items: any[]) => {
      quickPicks++;
      return quickPicks === 1 ? items.find(i => i.description === 'webapi') : items[0];
    });
    stub('showInputBox', async (opts: vscode.InputBoxOptions) => {
      assert.ok(opts.validateInput!('Sample.App'), 'duplicate project names are rejected');
      return 'SampleApp.Api';
    });
    stub('withProgress', async (_o: unknown, task: () => Promise<unknown>) => task());
    stub('showInformationMessage', async () => undefined);
    await withTimeout(vscode.commands.executeCommand('codestudio.newProject', backend), 300000, 'new project');
    restoreStubs(); watchErrors();
    const csproj = path.join(workspace, 'src', 'SampleApp.Api', 'SampleApp.Api.csproj');
    assert.ok(existsSync(csproj), 'project created under src/');
    assert.match(readFileSync(sln, 'utf8'), /SampleApp\.Api\.csproj/);
    assert.equal(api.manager.solution!.layout.assignments['src/SampleApp.Api/SampleApp.Api.csproj'], 'it-backend');
  });

  await step('New Item templates generate correct namespaces and compile', async () => {
    const addItem = async (target: ExplorerNode, templateId: string, name: string) => {
      stub('showQuickPick', async (items: any[]) => items.find(i => i.template.id === templateId));
      stub('showInputBox', async () => name);
      await vscode.commands.executeCommand('codestudio.newItem', target);
    };
    // General C# templates into a sub-folder of a class library.
    const modelsDir = path.join(workspace, 'src', 'Sample.Core', 'Domain', 'Orders');
    mkdirSync(modelsDir, { recursive: true });
    const core = await projectNode(api, 'Sample.Core');
    const domain = await child(api, core, 'Domain');
    const orders = await child(api, domain, 'Orders');
    const general: [string, string][] = [
      ['class', 'Order'], ['interface', 'IOrderRepository'], ['record', 'OrderPlaced'], ['struct', 'OrderId'],
      ['enum', 'OrderStatus'], ['static-class', 'OrderExtensions'], ['abstract-class', 'EntityBase'], ['exception', 'OrderException'],
    ];
    for (const [id, name] of general) await addItem(orders, id, name);
    // Web templates into the new web API project.
    await api.manager.reload();
    const web = await projectNode(api, 'SampleApp.Api');
    for (const [id, name] of [['api-controller', 'OrdersController'], ['minimal-api', 'OrderEndpoints'], ['background-service', 'CleanupWorker']]) {
      await addItem(web, id, name);
    }
    // Test template matching the test project's framework.
    await addItem(await projectNode(api, 'Sample.Tests'), 'xunit-test', 'OrderTests');
    restoreStubs(); watchErrors();

    const orderFile = readFileSync(path.join(modelsDir, 'Order.cs'), 'utf8');
    assert.match(orderFile, /^namespace Sample\.Core\.Domain\.Orders;/m);
    assert.match(readFileSync(path.join(workspace, 'src', 'SampleApp.Api', 'OrdersController.cs'), 'utf8'), /namespace SampleApp\.Api;/);
    assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, path.join(workspace, 'tests', 'Sample.Tests', 'OrderTests.cs'));

    // Adding a duplicate is rejected by the dialog's validation.
    let dupMessage: string | undefined;
    stub('showQuickPick', async (items: any[]) => items.find(i => i.template.id === 'class'));
    stub('showInputBox', async (opts: vscode.InputBoxOptions) => { dupMessage = await opts.validateInput!('Order') as string; return undefined; });
    await vscode.commands.executeCommand('codestudio.newItem', await child(api, await child(api, await projectNode(api, 'Sample.Core'), 'Domain'), 'Orders'));
    restoreStubs(); watchErrors();
    assert.match(dupMessage ?? '', /already exists/);

    // Everything generated must compile.
    let status = '';
    stub('setStatusBarMessage', (m: string) => { status = m; return { dispose() {} }; });
    await withTimeout(vscode.commands.executeCommand('codestudio.buildSolution'), 300000, 'build');
    restoreStubs(); watchErrors();
    if (!/succeeded/.test(status)) {
      const detail = await execDotnet(['build', sln, '-nologo', '-v', 'q'], workspace).then(() => 'CLI build succeeded', (e: Error) => e.message);
      const diags = vscode.languages.getDiagnostics().flatMap(([u, ds]) => ds.map(d => `${path.basename(u.fsPath)}:${d.range.start.line + 1} ${d.message}`));
      assert.fail(`build failed. problems=${JSON.stringify(diags.slice(0, 10))} errors=${JSON.stringify(errors)}\nCLI rebuild: ${detail.split('\n').filter(l => /error|warn/i.test(l)).slice(0, 15).join('\n')}`);
    }
  });


  await step('Coding standards: .editorconfig, live diagnostics, quick fix, build enforcement and clean revert', async () => {
    const cfg = () => vscode.workspace.getConfiguration('codestudio.codingStandards');
    const editorconfig = path.join(workspace, '.editorconfig');
    const badFile = path.join(workspace, 'src', 'Sample.Core', 'Inventory.cs');
    try {
      assert.equal(cfg().get('enabled'), false, 'off by default');
      assert.ok(!existsSync(editorconfig));

      stub('showInformationMessage', async () => undefined);
      await cfg().update('enabled', true, vscode.ConfigurationTarget.Workspace);
      await cfg().update('style.var', 'always', vscode.ConfigurationTarget.Workspace); // template code uses var everywhere
      await api.standards.syncEditorConfig();
      const written = readFileSync(editorconfig, 'utf8');
      assert.match(written, /# BEGIN CodeXStudio coding standards/);
      assert.match(written, /dotnet_naming_rule\.dp_private_fields\.severity = warning/);

      // Live diagnostics + quick fix (no C# extension here, so the file-local fallback rename is used).
      writeFileSync(badFile, 'namespace Sample.Core;\n\npublic class Inventory\n{\n    private int Count;\n\n    public int Add(int Amount)\n    {\n        var New_Total = Count + Amount;\n        Count = New_Total;\n        return New_Total;\n    }\n}\n');
      const doc = await vscode.workspace.openTextDocument(badFile);
      await vscode.window.showTextDocument(doc);
      api.standards.lint(doc);
      const diags = () => vscode.languages.getDiagnostics(doc.uri).filter(x => x.source === 'CodeXStudio');
      assert.deepEqual(diags().map(x => doc.getText(x.range)), ['Count', 'Amount', 'New_Total']);
      const target = diags().find(x => doc.getText(x.range) === 'New_Total')!;
      const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', doc.uri, target.range);
      const fix = actions.find(a => a.title === "Rename 'New_Total' to 'newTotal'");
      assert.ok(fix?.command, `quick fix offered; got ${actions.map(a => a.title).join(' | ')}`);
      await vscode.commands.executeCommand(fix.command.command, ...(fix.command.arguments ?? []));
      assert.equal((doc.getText().match(/\bnewTotal\b/g) ?? []).length, 3, 'all occurrences renamed');
      api.standards.lint(doc);
      assert.deepEqual(diags().map(x => doc.getText(x.range)), ['Count', 'Amount']);
      await doc.save();

      // Build enforcement: violations fail the build at severity "error", and pass once fixed.
      await cfg().update('severity', 'error', vscode.ConfigurationTarget.Workspace);
      await cfg().update('enforceInBuild', true, vscode.ConfigurationTarget.Workspace);
      await api.standards.syncEditorConfig();
      let status = '';
      stub('setStatusBarMessage', (m: string) => { status = m; return { dispose() {} }; });
      await withTimeout(vscode.commands.executeCommand('codestudio.buildProject', await projectNode(api, 'Sample.Core')), 240000, 'enforced build');
      const buildErrors = takeErrors();
      assert.equal(status, '', 'build must not succeed with violations');
      assert.ok(buildErrors.some(e => /Build Project: Sample.Core failed/.test(e)), JSON.stringify(buildErrors));
      // The problem matcher publishes diagnostics asynchronously after the task ends; poll for them.
      let all: string[] = [];
      let ide1006: string[] = [];
      for (let waited = 0; waited < 15000 && ide1006.length < 2; waited += 250) {
        await new Promise(r => setTimeout(r, 250));
        all = vscode.languages.getDiagnostics().flatMap(([u, ds]) => ds.filter(x => x.source !== 'CodeXStudio').map(x => `${u.fsPath}|${typeof x.code === 'object' ? x.code.value : x.code}|${x.message}`));
        ide1006 = all.filter(x => x.startsWith(badFile + '|') && x.includes('IDE1006'));
      }
      if (ide1006.length < 2) {
        const cli = await execDotnet(['build', path.join(workspace, 'src', 'Sample.Core', 'Sample.Core.csproj'), '-nologo', '-p:EnforceCodeStyleInBuild=true'], workspace)
          .then(() => 'CLI OK', (e: Error) => e.message.split('\n').filter(l => /error/.test(l)).slice(0, 6).join('\n'));
        assert.fail(`IDE1006 not in problems: ${JSON.stringify(all.slice(0, 5))}\nCLI:\n${cli}`);
      }

      writeFileSync(badFile, readFileSync(badFile, 'utf8').replace(/\bCount\b/g, '_count').replace(/\bAmount\b/g, 'amount'));
      await withTimeout(vscode.commands.executeCommand('codestudio.buildProject', await projectNode(api, 'Sample.Core')), 240000, 'clean build');
      assert.match(status, /succeeded/, `fixed code should build; errors: ${JSON.stringify(takeErrors())}`);

      // Turning the feature off removes CodeXStudio's .editorconfig (it created the file) and clears diagnostics.
      for (const key of ['severity', 'enforceInBuild', 'style.var', 'enabled']) await cfg().update(key, undefined, vscode.ConfigurationTarget.Workspace);
      await api.standards.syncEditorConfig();
      assert.ok(!existsSync(editorconfig), '.editorconfig created by CodeXStudio is removed');
      writeFileSync(badFile, readFileSync(badFile, 'utf8').replace('_count', 'Count'));
      api.standards.lint(await vscode.workspace.openTextDocument(badFile));
      assert.deepEqual(diags(), []);

      // A user-owned .editorconfig keeps its own content after enable/disable.
      writeFileSync(editorconfig, 'root = true\n\n[*]\nindent_style = space\n');
      await cfg().update('enabled', true, vscode.ConfigurationTarget.Workspace);
      await api.standards.syncEditorConfig();
      assert.match(readFileSync(editorconfig, 'utf8'), /indent_style = space[\s\S]*BEGIN CodeXStudio/);
      await cfg().update('enabled', undefined, vscode.ConfigurationTarget.Workspace);
      await api.standards.syncEditorConfig();
      assert.equal(readFileSync(editorconfig, 'utf8'), 'root = true\n\n[*]\nindent_style = space\n');
    } finally {
      for (const key of ['severity', 'enforceInBuild', 'style.var', 'enabled']) await cfg().update(key, undefined, vscode.ConfigurationTarget.Workspace);
      rmSync(editorconfig, { force: true });
      rmSync(badFile, { force: true });
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      restoreStubs(); watchErrors();
    }
  });

  await step('Run Tests runs dotnet test on a test project and refuses non-test projects', async () => {
    let ok = '';
    stub('setStatusBarMessage', (m: string) => { ok = m; return { dispose() {} }; });
    await withTimeout(vscode.commands.executeCommand('codestudio.runTests', await projectNode(api, 'Sample.Tests')), 300000, 'test');
    assert.match(ok, /Run Tests: Sample.Tests succeeded/);
    await vscode.commands.executeCommand('codestudio.runTests', await projectNode(api, 'Sample.Core'));
    restoreStubs(); watchErrors();
    assert.ok(takeErrors().some(e => /does not look like a test project/.test(e)));
  });

  await step('SQL database project: tree node, build to .dacpac, Publish needs the mssql extension', async () => {
    const dbDir = path.join(workspace, 'db', 'Sample.Db');
    const proj = path.join(dbDir, 'Sample.Db.sqlproj');
    mkdirSync(dbDir, { recursive: true });
    writeFileSync(proj, '<Project Sdk="Microsoft.Build.Sql/2.3.0">\n  <PropertyGroup>\n    <Name>Sample.Db</Name>\n    <DSP>Microsoft.Data.Tools.Schema.Sql.Sql160DatabaseSchemaProvider</DSP>\n  </PropertyGroup>\n</Project>\n');
    writeFileSync(path.join(dbDir, 'Customers.sql'), 'CREATE TABLE dbo.Customers (Id INT NOT NULL PRIMARY KEY, Name NVARCHAR(100) NOT NULL);\n');
    try {
      await execDotnet(['sln', sln, 'add', proj], workspace);
      await api.manager.reload();
      const node = await projectNode(api, 'Sample.Db');
      const item = await api.provider.getTreeItem(node);
      assert.equal(item.contextValue, 'project.sql');
      assert.equal((item.iconPath as vscode.ThemeIcon).id, 'database');
      assert.equal(item.description, 'SQL database');

      const dacpacNode = async () => (await api.provider.getChildren(node)).find(c => c.type === 'buildOutput')!;
      let output = await api.provider.getTreeItem(await dacpacNode());
      assert.equal(output.label, 'Sample.Db.dacpac');
      assert.equal(output.contextValue, 'dacpac.missing', 'not built yet');

      await withTimeout(vscode.commands.executeCommand('codestudio.buildProject', node), 300000, 'sqlproj build');
      assert.ok(existsSync(path.join(dbDir, 'bin', 'Debug', 'Sample.Db.dacpac')), '.dacpac built');
      output = await api.provider.getTreeItem(await dacpacNode());
      assert.equal(output.contextValue, 'dacpac');
      assert.equal(output.description, 'bin/Debug');

      // The test VS Code has no mssql extension: Publish explains and offers to show it.
      let info = '';
      stub('showInformationMessage', async (m: string) => { info = m; return undefined; });
      await vscode.commands.executeCommand('codestudio.publishSqlProject', node);
      assert.match(info, /mssql/);
      restoreStubs(); watchErrors();

      // Non-SQL projects are refused.
      await vscode.commands.executeCommand('codestudio.publishSqlProject', await projectNode(api, 'Sample.App'));
      assert.match(takeErrors().join(), /not a SQL database project/);
    } finally {
      restoreStubs(); watchErrors();
      await execDotnet(['sln', sln, 'remove', proj], workspace).catch(() => undefined);
      rmSync(path.join(workspace, 'db'), { recursive: true, force: true });
      await api.manager.reload();
    }
  });

  await step('Clean Solution runs dotnet clean', async () => {
    const dll = path.join(workspace, 'src', 'Sample.App', 'bin', 'Debug', 'net10.0', 'Sample.App.dll');
    assert.ok(existsSync(dll), 'precondition: build output exists');
    await withTimeout(vscode.commands.executeCommand('codestudio.cleanSolution'), 240000, 'clean');
    assert.ok(!existsSync(dll), 'clean should delete build output');
  });

  await step('Recommended settings picker writes only reviewed changes and keeps user values', async () => {
    const config = vscode.workspace.getConfiguration();
    await config.update('editor.minimap.enabled', true, vscode.ConfigurationTarget.Workspace);
    let offeredMinimap: { picked?: boolean } | undefined;
    let previewShown = false;
    let calls = 0;
    stub('showQuickPick', async (items: any[]) => {
      calls++;
      if (calls === 1) return items.find(i => /Workspace settings/.test(i.label));
      offeredMinimap = items.find(i => i.label === 'editor.minimap.enabled');
      return items.filter(i => i.picked);
    });
    stub('showInformationMessage', async (_m: string, opts: unknown) => {
      if (typeof opts === 'object' && opts && (opts as { modal?: boolean }).modal) {
        if (!previewShown) { previewShown = true; return 'Preview JSON'; }
        return 'Apply';
      }
      return undefined;
    });
    await vscode.commands.executeCommand('codestudio.applyRecommendedSettings');
    restoreStubs(); watchErrors();
    assert.ok(previewShown, 'preview step reached');
    assert.equal(offeredMinimap?.picked, false, 'user-set value must not be preselected');
    const after = vscode.workspace.getConfiguration();
    assert.equal(after.inspect('editor.minimap.enabled')!.workspaceValue, true, 'user value kept');
    assert.equal(after.inspect('editor.bracketPairColorization.enabled')!.workspaceValue, true);
    const cs = vscode.workspace.getConfiguration(undefined, { languageId: 'csharp' });
    assert.equal(cs.inspect('editor.formatOnSave')!.workspaceLanguageValue, true);
    const preview = vscode.workspace.textDocuments.find(d => d.isUntitled && d.getText().includes('CodeXStudio: settings'));
    assert.ok(preview, 'preview document opened');
    assert.ok(!preview.getText().includes('minimap'), 'unselected setting not in preview');
  });

  await step('CodeXStudio Dark and Light themes are contributed and selectable', async () => {
    const ext = vscode.extensions.getExtension('fhasancse.codeXstudio')!;
    const themes = ext.packageJSON.contributes.themes.map((t: { label: string }) => t.label);
    assert.deepEqual(themes, ['CodeXStudio Dark', 'CodeXStudio Light']);
    await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'CodeXStudio Light', vscode.ConfigurationTarget.Workspace);
    await new Promise(r => setTimeout(r, 1500));
    assert.equal(vscode.window.activeColorTheme.kind, vscode.ColorThemeKind.Light);
    await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'CodeXStudio Dark', vscode.ConfigurationTarget.Workspace);
    await new Promise(r => setTimeout(r, 1500));
    assert.equal(vscode.window.activeColorTheme.kind, vscode.ColorThemeKind.Dark);
  });

  const failed = results.filter(r => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} integration steps passed`);
  if (failed.length) throw new Error(`${failed.length} integration step(s) failed: ${failed.map(f => f.name).join('; ')}`);
}
