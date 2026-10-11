// Opt-in suite (npm run test:integration:mssql): runs with Microsoft's SQL Server (mssql) extension
// installed and checks that CodeXStudio's SQL commands open its dialogs.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { CodeXStudioApi } from '../../src/extension';
import type { ExplorerNode } from '../../src/explorer/solution-tree-item';

function execDotnet(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile('dotnet', args, { cwd }, (err, stdout, stderr) => (err ? reject(new Error(`${stdout}\n${stderr}`.trim() || err.message)) : resolve())));
}

const tabLabels = () => vscode.window.tabGroups.all.flatMap(g => g.tabs).map(t => t.label);

/** Waits for an editor tab (Microsoft's dialogs are webview tabs) whose title matches. */
async function waitForTab(pattern: RegExp, timeoutMs: number): Promise<string> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const hit = tabLabels().find(l => pattern.test(l));
    if (hit) return hit;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`No tab matching ${pattern} within ${timeoutMs} ms. Open tabs: ${JSON.stringify(tabLabels())}`);
}

const errors: string[] = [];
const results: { name: string; ok: boolean }[] = [];
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    assert.deepEqual(errors.splice(0), [], 'unexpected error notifications');
    results.push({ name, ok: true });
    console.log(`  ✔ ${name}`);
  } catch (err) {
    errors.splice(0);
    results.push({ name, ok: false });
    console.log(`  ✘ ${name}\n${(err as Error).stack}`);
  }
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

export async function run(): Promise<void> {
  const workspace = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const sln = path.join(workspace, 'SampleApp.sln');
  const dbDir = path.join(workspace, 'db', 'Sample.Db');
  const proj = path.join(dbDir, 'Sample.Db.sqlproj');
  console.log('CodeXStudio + mssql integration tests');
  const win = vscode.window as unknown as Record<string, (...a: any[]) => any>;
  win.showErrorMessage = async (m: string) => { errors.push(m); return undefined; };

  let api!: CodeXStudioApi;
  let node!: ExplorerNode;
  await step('mssql is installed and CodeXStudio opens a solution with a SQL project', async () => {
    const mssql = vscode.extensions.getExtension('ms-mssql.mssql');
    assert.ok(mssql, 'ms-mssql.mssql not installed in the test instance');
    console.log(`    mssql ${mssql.packageJSON.version}`);
    mkdirSync(dbDir, { recursive: true });
    writeFileSync(proj, '<Project Sdk="Microsoft.Build.Sql/2.3.0">\n  <PropertyGroup>\n    <Name>Sample.Db</Name>\n    <DSP>Microsoft.Data.Tools.Schema.Sql.Sql160DatabaseSchemaProvider</DSP>\n  </PropertyGroup>\n</Project>\n');
    writeFileSync(path.join(dbDir, 'Customers.sql'), 'CREATE TABLE dbo.Customers (Id INT NOT NULL PRIMARY KEY, Name NVARCHAR(100) NOT NULL);\n');
    await execDotnet(['sln', sln, 'add', proj], workspace);
    api = await vscode.extensions.getExtension<CodeXStudioApi>('fhasancse.codeXstudio')!.activate();
    await api.ready;
    await vscode.commands.executeCommand('codestudio.openSolution', sln);
    const project = api.manager.solution!.model.projects.find(p => p.name === 'Sample.Db');
    assert.ok(project, 'Sample.Db in solution');
    node = { type: 'structure', node: { kind: 'project', id: `project:${project.key}`, label: project.name, project } };
  });

  await step('Publish... opens the mssql Publish Project dialog', async () => {
    await vscode.commands.executeCommand('codestudio.publishSqlProject', node);
    console.log(`    tab: ${await waitForTab(/publish/i, 180000)}`);
  });

  await step('Schema Compare... opens mssql Schema Compare', async () => {
    await vscode.commands.executeCommand('codestudio.schemaCompareSqlProject', node);
    console.log(`    tab: ${await waitForTab(/schema compare/i, 180000)}`);
  });

  await step('Deploy DACPAC... opens the mssql DACPAC dialog and copies the .dacpac path', async () => {
    await vscode.commands.executeCommand('codestudio.buildProject', node);
    const dacpac = path.join(dbDir, 'bin', 'Debug', 'Sample.Db.dacpac');
    assert.ok(existsSync(dacpac), '.dacpac built');
    const output = (await api.provider.getChildren(node)).find(c => c.type === 'buildOutput');
    assert.ok(output, 'build output node');
    await vscode.commands.executeCommand('codestudio.deployDacpac', output);
    assert.equal(await vscode.env.clipboard.readText(), dacpac);
    console.log(`    tab: ${await waitForTab(/dacpac|data-tier/i, 180000)}`);
  });

  const failed = results.filter(r => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} mssql integration steps passed`);
  if (failed.length) throw new Error(`${failed.length} mssql step(s) failed: ${failed.map(f => f.name).join('; ')}`);
}
