import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { addProjectToSolutionArgs, addProjectToSolutionFolderArgs, newProjectArgs } from '../dotnet/dotnet-args';
import { ExplorerNode } from '../explorer/solution-tree-item';
import { addSolutionItem, solutionFolderPath } from '../solution/solution-folder-writer';
import { normalizeRelativePath, SolutionFolder, SolutionModel, SolutionProject } from '../solution/solution-model';
import { assignProject } from '../storage/layout-store';
import { computeNamespace, ItemTemplate, rankTemplates, toIdentifier, validateTypeName } from '../templates/item-templates';
import {
  FALLBACK_PROJECT_TEMPLATES,
  parseTemplateList,
  ProjectTemplate,
  suggestedParentFolder,
  validateProjectName,
  validateTemplateShortName,
} from '../templates/project-templates';
import { CommandContext, projectsInSolutionFolder, registerCommand, requireSolution, resolveProject, solutionFolderTarget, UserFacingError } from './command-context';

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

/** "Add > New Item" on a solution folder without a project: the file goes to <solution dir>/<folder path>/ and is listed in the folder. */
async function newSolutionItem(ctx: CommandContext, model: SolutionModel, folder: SolutionFolder): Promise<void> {
  const emptyFile = { label: '$(file) Empty file', description: 'any name and extension (README.md, notes.txt, ...)', template: undefined as ItemTemplate | undefined };
  const pick = await vscode.window.showQuickPick(
    [...rankTemplates({ packages: [], isTestProject: false }).map(t => ({ label: t.label, description: t.description, template: t as ItemTemplate | undefined })), emptyFile],
    { title: `New Solution Item in "${folder.name}"`, placeHolder: 'Select an item template', matchOnDescription: true },
  );
  if (!pick) return;
  const template = pick.template;
  const folderSegments = solutionFolderPath(model, folder.id).split('/');
  const dir = path.join(model.directory, ...folderSegments);
  const fileName = (raw: string) => (template ? `${raw.trim().replace(/\.cs$/i, '')}.cs` : raw.trim());
  const name = (await vscode.window.showInputBox({
    title: template ? `New ${template.label}` : 'New file',
    prompt: `File is created in ${vscode.workspace.asRelativePath(dir)} and listed under "${folder.name}"`,
    value: template?.defaultName ?? 'README.md',
    validateInput: async v => {
      const err = template ? validateTypeName(v) : /^[^\\/:*?"<>|\x00-\x1f]+$/.test(v.trim()) && !/^\.+$/.test(v.trim()) ? undefined : 'Enter a file name such as README.md.';
      if (err) return err;
      try {
        await fs.access(path.join(dir, fileName(v)));
        return 'A file with this name already exists.';
      } catch {
        return undefined;
      }
    },
  }))?.trim();
  if (!name) return;
  const file = path.join(dir, fileName(name));
  const namespace = [model.name, ...folderSegments].flatMap(s => s.split('.')).map(toIdentifier).join('.');
  const content = template ? template.render({ namespace, name: name.replace(/\.cs$/i, '') }) : '';
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, content, { encoding: 'utf8', flag: 'wx' });
  try {
    const text = await fs.readFile(model.path, 'utf8');
    const rel = normalizeRelativePath(path.relative(model.directory, file));
    await fs.writeFile(model.path, addSolutionItem(model.format, text, model, folder.id, rel), 'utf8');
  } catch (err) {
    await fs.rm(file, { force: true });
    throw err;
  }
  ctx.logger.info(`Created solution item ${file} in folder "${folder.name}".`);
  await ctx.manager.reload();
  await vscode.window.showTextDocument(vscode.Uri.file(file));
}

export function registerTemplateCommands(ctx: CommandContext): void {
  registerCommand(ctx, 'codestudio.newProject', 'New Project', async (node?: unknown) => {
    const { model } = requireSolution(ctx);
    const n = node as ExplorerNode | undefined;
    const targetFolderId = n?.type === 'structure' && n.node.kind === 'virtualFolder' ? n.node.folder.id : undefined;
    const solutionFolder = solutionFolderTarget(model, node);

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
        await ctx.runner.exec(
          solutionFolder ? addProjectToSolutionFolderArgs(model.path, file, solutionFolder.path) : addProjectToSolutionArgs(model.path, file),
          model.directory,
        );
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
    } else if (n?.type === 'structure' && n.node.kind === 'solutionFolder') {
      // As in Visual Studio: add the file to a project inside the folder, or as a solution item of the folder itself.
      const { model } = requireSolution(ctx);
      const folder = n.node.folder;
      const candidates = projectsInSolutionFolder(model, folder.id).filter(p => p.kind === 'csharp');
      const asItem = { label: '$(file-add) Solution item', description: `file in "${folder.name}", not part of any project`, project: undefined as SolutionProject | undefined };
      const choice = candidates.length === 0 ? asItem : await vscode.window.showQuickPick(
        [...candidates.map(p => ({ label: p.name, description: p.relativePath, project: p as SolutionProject | undefined })), asItem],
        { placeHolder: `Add a new item to "${folder.name}": pick a project, or add a solution item`, matchOnDescription: true },
      );
      if (!choice) return;
      if (!choice.project) return newSolutionItem(ctx, model, folder);
      project = choice.project;
      if (!project) return;
      targetDir = path.dirname(project.absolutePath);
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
