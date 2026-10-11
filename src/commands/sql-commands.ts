import * as path from 'path';
import * as vscode from 'vscode';
import { ExplorerNode } from '../explorer/solution-tree-item';
import { sqlSdkCompatibilityWarning } from '../sql/sql-project';
import { SolutionProject } from '../solution/solution-model';
import { CommandContext, registerCommand, resolveProject, UserFacingError } from './command-context';

/**
 * SQL database projects: CodeXStudio builds them with `dotnet build` and hands Publish, Schema
 * Compare and DACPAC deployment to Microsoft's mssql extension, which owns connections and DacFx.
 * mssql is an optional dependency: everything else works without it.
 */
const MSSQL_EXTENSION_ID = 'ms-mssql.mssql';
const PUBLISH_COMMAND = 'mssql.publishDatabaseProject';
const SCHEMA_COMPARE_COMMAND = 'mssql.schemaCompare';
const DEPLOY_DACPAC_COMMAND = 'mssql.dacpacDialog.deploy';

/** Activates mssql and checks that it still provides `command`; offers to install it otherwise. */
async function ensureMssqlCommand(command: string, feature: string): Promise<boolean> {
  const ext = vscode.extensions.getExtension(MSSQL_EXTENSION_ID);
  if (!ext) {
    const choice = await vscode.window.showInformationMessage(
      `CodeXStudio: ${feature} uses Microsoft's SQL Server (mssql) extension, which is not installed.`,
      'Show Extension',
    );
    if (choice) await vscode.commands.executeCommand('workbench.extensions.search', MSSQL_EXTENSION_ID);
    return false;
  }
  await ext.activate();
  if (!(await vscode.commands.getCommands(true)).includes(command)) {
    throw new UserFacingError(`${feature} needs a newer version of the SQL Server (mssql) extension (command "${command}" was not found). Update it and try again.`);
  }
  return true;
}

async function sqlProject(ctx: CommandContext, node: unknown, placeHolder: string): Promise<SolutionProject | undefined> {
  const project = await resolveProject(ctx, node, placeHolder);
  if (project && project.kind !== 'sqlproj') throw new UserFacingError(`${project.name} is not a SQL database project (.sqlproj).`);
  return project;
}

const warned = new Set<string>();

/**
 * Before building, warns (once per project and session) about SQL projects whose
 * Microsoft.Build.Sql version cannot build with the active .NET SDK.
 */
export async function warnIncompatibleSqlProjects(ctx: CommandContext, target: string): Promise<void> {
  const projects = ctx.manager.solution?.model.projects.filter(p =>
    p.kind === 'sqlproj' && (path.resolve(target) === path.resolve(p.absolutePath) || /\.slnx?$/i.test(target))) ?? [];
  if (projects.length === 0) return;
  const version = await ctx.runner.ensureSdk().then(i => i.version, () => undefined);
  if (!version) return;
  for (const p of projects) {
    if (warned.has(p.absolutePath)) continue;
    const info = await ctx.manager.projectInfo(p.absolutePath).catch(() => undefined);
    const warning = info && sqlSdkCompatibilityWarning(info.sdk, version);
    if (!warning) continue;
    warned.add(p.absolutePath);
    void vscode.window.showWarningMessage(`CodeXStudio: ${p.name}: ${warning}`, 'Open Project File').then(choice => {
      if (choice) void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(p.absolutePath));
    });
  }
}

export function registerSqlCommands(ctx: CommandContext): void {
  registerCommand(ctx, 'codestudio.publishSqlProject', 'Publish SQL Project', async (node?: unknown) => {
    const project = await sqlProject(ctx, node, 'Select the SQL project to publish');
    if (!project || !(await ensureMssqlCommand(PUBLISH_COMMAND, 'Publish'))) return;
    await vscode.commands.executeCommand(PUBLISH_COMMAND, project.absolutePath);
  });

  registerCommand(ctx, 'codestudio.schemaCompareSqlProject', 'Schema Compare', async (node?: unknown) => {
    const project = await sqlProject(ctx, node, 'Select the SQL project to compare');
    if (!project || !(await ensureMssqlCommand(SCHEMA_COMPARE_COMMAND, 'Schema Compare'))) return;
    // (source, target): the project is the source; the user picks the target database in the dialog.
    await vscode.commands.executeCommand(SCHEMA_COMPARE_COMMAND, project.absolutePath, undefined);
  });

  registerCommand(ctx, 'codestudio.deployDacpac', 'Deploy DACPAC', async (node?: unknown) => {
    const n = node as ExplorerNode | undefined;
    if (!(await ensureMssqlCommand(DEPLOY_DACPAC_COMMAND, 'Deploy DACPAC'))) return;
    if (n?.type === 'buildOutput') {
      // The dialog has no file argument; put the path on the clipboard so it can be pasted.
      await vscode.env.clipboard.writeText(n.uri.fsPath);
      void vscode.window.setStatusBarMessage(`$(clippy) Copied ${path.basename(n.uri.fsPath)} path; paste it into the Deploy DACPAC dialog`, 8000);
    }
    await vscode.commands.executeCommand(DEPLOY_DACPAC_COMMAND);
  });
}
