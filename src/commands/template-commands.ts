import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { addProjectToSolutionArgs, newProjectArgs } from '../dotnet/dotnet-args';
import { ExplorerNode } from '../explorer/solution-tree-item';
import { normalizeRelativePath } from '../solution/solution-model';
import { assignProject } from '../storage/layout-store';
import { computeNamespace, rankTemplates, validateTypeName } from '../templates/item-templates';
import {
  FALLBACK_PROJECT_TEMPLATES,
  parseTemplateList,
  ProjectTemplate,
  suggestedParentFolder,
  validateProjectName,
  validateTemplateShortName,
} from '../templates/project-templates';
import { CommandContext, registerCommand, requireSolution, resolveProject, UserFacingError } from './command-context';

async function listProjectTemplates(ctx: CommandContext): Promise<ProjectTemplate[]> {
  try {
    const { stdout } = await ctx.runner.exec(['new', 'list', '--type', 'project'], requireSolution(ctx).model.directory, 60000);
    const parsed = parseTemplateList(stdout);
    if (parsed.length) return parsed;
    ctx.logger.warn('Could not parse `dotnet new list` output; using the built-in template list.');
  } catch (err) {
    ctx.logger.warn(`dotnet new list failed (${(err as Error).message}); using the built-in template list.`);
  }
  return [...FALLBACK_PROJECT_TEMPLATES];
}

async function isEmptyOrMissing(dir: string): Promise<boolean> {
  try {
    return (await fs.readdir(dir)).length === 0;
  } catch {
    return true;
  }
}

async function findProjectFile(dir: string, name: string): Promise<string> {
  const entries = await fs.readdir(dir);
  const projectFiles = entries.filter(e => /\.(cs|fs|vb)proj$/i.test(e));
  const exact = projectFiles.find(e => path.basename(e, path.extname(e)) === name);
  const found = exact ?? projectFiles[0];
  if (!found) throw new Error(`The template did not create a project file in ${dir}.`);
  return path.join(dir, found);
}

export function registerTemplateCommands(ctx: CommandContext): void {
  registerCommand(ctx, 'codestudio.newProject', 'New Project', async (node?: unknown) => {
    const { model } = requireSolution(ctx);
    const n = node as ExplorerNode | undefined;
    const targetFolderId = n?.type === 'structure' && n.node.kind === 'virtualFolder' ? n.node.folder.id : undefined;

    const templates = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Loading .NET templates...' },
      () => listProjectTemplates(ctx),
    );
    const other = { label: '$(edit) Other template...', description: 'Enter a template short name', template: undefined as ProjectTemplate | undefined };
    const pick = await vscode.window.showQuickPick(
      [
        ...templates.map(t => ({ label: t.name, description: t.shortName, detail: [t.languages.join(', '), t.tags].filter(Boolean).join('  ·  '), template: t as ProjectTemplate | undefined })),
        other,
      ],
      { title: 'New Project', placeHolder: 'Select a project template', matchOnDescription: true, matchOnDetail: true },
    );
    if (!pick) return;
    let template = pick.template;
    if (!template) {
      const shortName = await vscode.window.showInputBox({ title: 'New Project', prompt: 'Template short name (see `dotnet new list`)', validateInput: validateTemplateShortName });
      if (!shortName) return;
      template = { name: shortName.trim(), shortName: shortName.trim(), languages: [], tags: '' };
    }

    const existing = model.projects.map(p => p.name);
    const name = (await vscode.window.showInputBox({
      title: `New ${template.name}`,
      prompt: 'Project name',
      value: `${model.name}.${template.shortName === 'classlib' ? 'Core' : 'Project1'}`,
      validateInput: v => validateProjectName(v, existing),
    }))?.trim();
    if (!name) return;

    const parent = path.join(model.directory, suggestedParentFolder(template));
    const suggested = path.join(parent, name);
    const location = await vscode.window.showQuickPick(
      [
        { label: vscode.workspace.asRelativePath(suggested), description: 'Suggested location', dir: suggested as string | undefined },
        { label: '$(folder-opened) Browse...', description: 'Choose a parent folder', dir: undefined as string | undefined },
      ],
      { title: `New ${template.name}`, placeHolder: 'Where should the project be created?' },
    );
    if (!location) return;
    let outputDir = location.dir;
    if (!outputDir) {
      const chosen = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, defaultUri: vscode.Uri.file(model.directory), openLabel: 'Create Here' });
      if (!chosen?.[0]) return;
      outputDir = path.join(chosen[0].fsPath, name);
    }
    if (!(await isEmptyOrMissing(outputDir))) throw new UserFacingError(`${outputDir} already exists and is not empty.`);
    const finalDir = outputDir;

    const projectFile = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Creating ${name} from "${template.shortName}"...` },
      async () => {
        await ctx.runner.exec(newProjectArgs(template.shortName, name, finalDir), model.directory, 300000);
        const file = await findProjectFile(finalDir, name);
        await ctx.runner.exec(addProjectToSolutionArgs(model.path, file), model.directory);
        return file;
      },
    );

    await ctx.manager.reload();
    if (targetFolderId) {
      const key = normalizeRelativePath(path.relative(model.directory, projectFile));
      const added = ctx.manager.solution?.model.projects.find(p => p.key === key || path.resolve(p.absolutePath) === path.resolve(projectFile));
      if (added) await ctx.manager.updateLayout(l => assignProject(l, added.key, targetFolderId));
    }
    void vscode.window.showInformationMessage(`CodeXStudio: Created ${name} and added it to ${model.name}.`);
  });

  registerCommand(ctx, 'codestudio.newItem', 'New Item', async (node?: unknown) => {
    const n = node as ExplorerNode | undefined;
    let project;
    let targetDir: string;
    if (n?.type === 'physicalFolder') {
      project = n.project;
      targetDir = n.uri.fsPath;
    } else {
      project = await resolveProject(ctx, node, 'Add a new item to which project?');
      if (!project) return;
      targetDir = path.dirname(project.absolutePath);
    }
    if (project.kind !== 'csharp') throw new UserFacingError(`Item templates are available for C# projects only (${project.name} is ${project.kind}).`);

    const info = await ctx.manager.projectInfo(project.absolutePath);
    const templates = rankTemplates(info);
    const pick = await vscode.window.showQuickPick(
      templates.map(t => ({ label: t.label, description: t.description, template: t })),
      { title: `New Item in ${project.name}`, placeHolder: 'Select an item template', matchOnDescription: true },
    );
    if (!pick) return;
    const template = pick.template;

    const dir = targetDir;
    const name = (await vscode.window.showInputBox({
      title: `New ${template.label}`,
      prompt: `Name (file: <name>.cs in ${vscode.workspace.asRelativePath(dir)})`,
      value: template.defaultName,
      valueSelection: [0, template.defaultName.length],
      validateInput: async v => {
        const err = validateTypeName(v);
        if (err) return err;
        try {
          await fs.access(path.join(dir, `${v.trim().replace(/\.cs$/i, '')}.cs`));
          return 'A file with this name already exists.';
        } catch {
          return undefined;
        }
      },
    }))?.trim().replace(/\.cs$/i, '');
    if (!name) return;

    const namespace = computeNamespace(project.absolutePath, dir, info.rootNamespace);
    const file = path.join(dir, `${name}.cs`);
    await fs.mkdir(dir, { recursive: true });
    // 'wx' fails instead of overwriting if the file appeared after validation.
    await fs.writeFile(file, template.render({ namespace, name }), { encoding: 'utf8', flag: 'wx' });
    ctx.logger.info(`Created ${file} from template "${template.id}" (namespace ${namespace}).`);
    ctx.provider.refresh();
    await vscode.window.showTextDocument(vscode.Uri.file(file));
  });
}
