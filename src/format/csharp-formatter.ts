import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { DotnetRunner, execWithInput } from '../dotnet/dotnet-runner';
import { Logger } from '../logger';
import { isRootEditorConfig, mergeEditorConfigs } from './editorconfig-chain';

export type FormatterEngine = 'dotnet-format' | 'csharpier';

function formatterConfig() {
  const c = vscode.workspace.getConfiguration('codestudio.formatter');
  return {
    enabled: c.get<boolean>('enabled', true),
    engine: (c.get<string>('engine') === 'csharpier' ? 'csharpier' : 'dotnet-format') as FormatterEngine,
  };
}

export class CSharpierMissingError extends Error {
  constructor() {
    super('CSharpier is not installed. Run "CodeStudio: Install CSharpier" or switch "codestudio.formatter.engine" to dotnet-format.');
    this.name = 'CSharpierMissingError';
  }
}

/**
 * C# document formatter. "dotnet-format" runs `dotnet format whitespace` on a copy of the buffer
 * in a temp folder (with the applicable .editorconfig rules merged in), so unsaved text can be
 * formatted and nothing is written next to the user's files. "csharpier" pipes the buffer through
 * `dotnet csharpier format --write-stdout` from the file's folder so its config and tool manifest apply.
 */
export class CSharpFormatter implements vscode.DocumentFormattingEditProvider, vscode.Disposable {
  private registration: vscode.Disposable | undefined;
  private readonly configSub: vscode.Disposable;

  constructor(private readonly runner: DotnetRunner, private readonly logger: Logger) {
    this.configSub = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('codestudio.formatter')) this.updateRegistration();
    });
    this.updateRegistration();
  }

  get registered(): boolean {
    return this.registration !== undefined;
  }

  private updateRegistration(): void {
    const { enabled } = formatterConfig();
    if (enabled && !this.registration) {
      this.registration = vscode.languages.registerDocumentFormattingEditProvider([{ language: 'csharp' }, { pattern: '**/*.cs' }], this);
    } else if (!enabled && this.registration) {
      this.registration.dispose();
      this.registration = undefined;
    }
  }

  async provideDocumentFormattingEdits(doc: vscode.TextDocument, options: vscode.FormattingOptions, token: vscode.CancellationToken): Promise<vscode.TextEdit[]> {
    const original = doc.getText();
    let formatted: string;
    try {
      formatted = await this.format(original, doc.uri.scheme === 'file' ? doc.uri.fsPath : undefined, options);
    } catch (err) {
      this.logger.error(`Formatting ${doc.fileName} failed`, err);
      const actions = err instanceof CSharpierMissingError ? ['Install CSharpier', 'Use dotnet format'] : ['Show Log'];
      void vscode.window.showErrorMessage(`CodeStudio: Formatting failed. ${(err as Error).message}`, ...actions).then(choice => {
        if (choice === 'Install CSharpier') void vscode.commands.executeCommand('codestudio.installCSharpier');
        else if (choice === 'Use dotnet format') void vscode.workspace.getConfiguration('codestudio.formatter').update('engine', 'dotnet-format', vscode.ConfigurationTarget.Global);
        else if (choice === 'Show Log') this.logger.show();
      });
      return [];
    }
    if (token.isCancellationRequested || formatted === original) return [];
    const full = new vscode.Range(doc.positionAt(0), doc.positionAt(original.length));
    return [vscode.TextEdit.replace(full, formatted)];
  }

  /** Formats C# source text. `filePath` locates .editorconfig / CSharpier configuration. */
  async format(text: string, filePath: string | undefined, options: vscode.FormattingOptions): Promise<string> {
    await this.runner.ensureSdk();
    const { engine } = formatterConfig();
    return engine === 'csharpier' ? this.formatWithCSharpier(text, filePath) : this.formatWithDotnetFormat(text, filePath, options);
  }

  private async formatWithCSharpier(text: string, filePath: string | undefined): Promise<string> {
    const cwd = filePath ? path.dirname(filePath) : os.tmpdir();
    const result = await execWithInput(this.runner.dotnetPath, ['csharpier', 'format', '--write-stdout'], cwd, text);
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout).trim();
      if (/could not execute|command or file was not found|No executable found/i.test(detail)) throw new CSharpierMissingError();
      throw new Error(`CSharpier exited with code ${result.code}: ${detail.split(/\r?\n/).slice(0, 3).join(' ')}`);
    }
    return result.stdout;
  }

  private async formatWithDotnetFormat(text: string, filePath: string | undefined, options: vscode.FormattingOptions): Promise<string> {
    const configs = filePath ? await collectEditorConfigs(path.dirname(filePath)) : [];
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codestudio-format-'));
    try {
      const name = filePath ? path.basename(filePath) : 'Untitled.cs';
      await fs.writeFile(path.join(dir, '.editorconfig'), mergeEditorConfigs(configs, options), 'utf8');
      await fs.writeFile(path.join(dir, name), text, 'utf8');
      await this.runner.exec(['format', 'whitespace', dir, '--folder', '--include', name], dir, 60000);
      return await fs.readFile(path.join(dir, name), 'utf8');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  dispose(): void {
    this.registration?.dispose();
    this.configSub.dispose();
  }
}

/** Reads .editorconfig files from `dir` upward until one declares root = true; returns them outermost first. */
async function collectEditorConfigs(dir: string): Promise<string[]> {
  const found: string[] = [];
  let current = dir;
  for (;;) {
    try {
      const text = await fs.readFile(path.join(current, '.editorconfig'), 'utf8');
      found.unshift(text);
      if (isRootEditorConfig(text)) break;
    } catch {
      // no .editorconfig here
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return found;
}
