import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Logger } from '../logger';
import { SolutionManager } from '../solution-manager';
import { findIdentifierOccurrences, lintCSharpNaming, NamingViolation } from './csharp-naming-linter';
import { generateSection, hasSection, isOnlyRootLine, removeSection, upsertSection } from './editorconfig';
import { CodingStandards, readStandards } from './standards-config';

const SECTION = 'codestudio.codingStandards';
const DIAGNOSTIC_CODE = 'DP1006';
const CREATED_KEY = 'codestudio.editorconfigCreatedByCodeXStudio';
const NOTIFIED_KEY = 'codestudio.editorconfigNotified';
const MAX_LINT_SIZE = 1024 * 1024;

export function standardsConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

export function standardsEnabled(): boolean {
  return standardsConfig().get<boolean>('enabled', false);
}

export function currentStandards(): CodingStandards {
  const c = standardsConfig();
  return readStandards(key => c.get(key));
}

/** dotnet format/build arguments for the configured severity. */
export function formatSeverity(s: CodingStandards): 'info' | 'warn' | 'error' {
  return s.severity === 'suggestion' ? 'info' : s.severity === 'warning' ? 'warn' : 'error';
}

function toDiagnosticSeverity(s: CodingStandards['severity']): vscode.DiagnosticSeverity {
  return s === 'error' ? vscode.DiagnosticSeverity.Error : s === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information;
}

function shouldLint(doc: vscode.TextDocument): boolean {
  if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'untitled') return false;
  if (doc.languageId !== 'csharp' && !doc.fileName.endsWith('.cs')) return false;
  if (/[\\/](obj|bin)[\\/]/.test(doc.fileName) || /\.(g|g\.i|designer|generated)\.cs$/i.test(doc.fileName)) return false;
  return doc.getText().length <= MAX_LINT_SIZE;
}

/**
 * Enforces CodeXStudio coding standards when `codestudio.codingStandards.enabled` is on:
 * live naming diagnostics with rename quick fixes, and a managed .editorconfig section
 * beside the solution so Roslyn, `dotnet format` and the build apply the same rules.
 */
export class StandardsController implements vscode.Disposable, vscode.CodeActionProvider {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('codestudio-standards');
  private readonly violations = new WeakMap<vscode.Diagnostic, NamingViolation>();
  private readonly disposables: vscode.Disposable[] = [this.diagnostics];
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private syncChain: Promise<void> = Promise.resolve();
  private lastSolutionDir: string | undefined;

  constructor(
    private readonly manager: SolutionManager,
    private readonly workspaceState: vscode.Memento,
    private readonly logger: Logger,
  ) {
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument(d => this.lint(d)),
      vscode.workspace.onDidChangeTextDocument(e => this.scheduleLint(e.document)),
      vscode.workspace.onDidCloseTextDocument(d => this.diagnostics.delete(d.uri)),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(SECTION)) {
          this.lintAll();
          void this.syncEditorConfig();
        }
      }),
      manager.onDidChange(() => {
        if (manager.solution?.model.directory !== this.lastSolutionDir) void this.syncEditorConfig();
      }),
      vscode.languages.registerCodeActionsProvider([{ language: 'csharp' }, { pattern: '**/*.cs' }], this, {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      }),
    );
    this.lintAll();
  }

  // --- Live diagnostics ---

  lintAll(): void {
    for (const doc of vscode.workspace.textDocuments) this.lint(doc);
  }

  private scheduleLint(doc: vscode.TextDocument): void {
    const key = doc.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      this.lint(doc);
    }, 300));
  }

  lint(doc: vscode.TextDocument): void {
    if (!standardsEnabled() || !shouldLint(doc)) {
      this.diagnostics.delete(doc.uri);
      return;
    }
    const standards = currentStandards();
    let found: NamingViolation[];
    try {
      found = lintCSharpNaming(doc.getText(), standards);
    } catch (err) {
      this.logger.error(`Naming check failed for ${doc.fileName}`, err);
      return;
    }
    const severity = toDiagnosticSeverity(standards.severity);
    this.diagnostics.set(doc.uri, found.map(v => {
      const range = new vscode.Range(doc.positionAt(v.offset), doc.positionAt(v.offset + v.length));
      const d = new vscode.Diagnostic(range, v.message, severity);
      d.source = 'CodeXStudio';
      d.code = DIAGNOSTIC_CODE;
      this.violations.set(d, v);
      return d;
    }));
  }

  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const d of context.diagnostics) {
      const v = this.violations.get(d);
      if (!v?.suggestion) continue;
      const scope = v.renameRange ? '' : ' (uses the C# language service)';
      const action = new vscode.CodeAction(`Rename '${v.name}' to '${v.suggestion}'${scope}`, vscode.CodeActionKind.QuickFix);
      action.diagnostics = [d];
      action.isPreferred = true;
      action.command = {
        command: 'codestudio.renameToStandard',
        title: action.title,
        arguments: [doc.uri, v.offset, v.name, v.suggestion, v.renameRange],
      };
      actions.push(action);
    }
    return actions;
  }

  /**
   * Renames through the language service when one is available (solution-wide, semantic);
   * otherwise renames file-local symbols (private fields, locals, parameters) textually.
   */
  async renameToStandard(uri: vscode.Uri, offset: number, oldName: string, newName: string, renameRange?: { start: number; end: number }): Promise<boolean> {
    const doc = await vscode.workspace.openTextDocument(uri);
    const position = doc.positionAt(offset);
    if (doc.getText(new vscode.Range(position, doc.positionAt(offset + oldName.length))) !== oldName) {
      throw new Error(`'${oldName}' is no longer at that position; re-run the quick fix.`);
    }
    try {
      const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit | undefined>('vscode.executeDocumentRenameProvider', uri, position, newName);
      if (edit && edit.size > 0) return vscode.workspace.applyEdit(edit);
    } catch {
      // No rename provider registered (no C# extension) – fall back below.
    }
    if (!renameRange) {
      void vscode.window.showWarningMessage(
        `CodeXStudio: Renaming '${oldName}' safely needs a C# language extension (it may be used in other files). Install one, then use F2 (Rename Symbol).`,
      );
      return false;
    }
    const text = doc.getText();
    const edit = new vscode.WorkspaceEdit();
    for (const at of findIdentifierOccurrences(text, oldName, renameRange)) {
      edit.replace(uri, new vscode.Range(doc.positionAt(at), doc.positionAt(at + oldName.length)), newName);
    }
    return vscode.workspace.applyEdit(edit);
  }

  // --- .editorconfig synchronisation ---

  editorConfigPath(): string | undefined {
    const dir = this.manager.solution?.model.directory;
    return dir ? path.join(dir, '.editorconfig') : undefined;
  }

  syncEditorConfig(): Promise<void> {
    this.syncChain = this.syncChain.then(() => this.doSync()).catch(err => {
      this.logger.error('Updating .editorconfig failed', err);
      void vscode.window.showErrorMessage(`CodeXStudio: Could not update .editorconfig. ${(err as Error).message}`);
    });
    return this.syncChain;
  }

  private async doSync(): Promise<void> {
    const file = this.editorConfigPath();
    this.lastSolutionDir = this.manager.solution?.model.directory;
    if (!file) return;
    let existing: string | undefined;
    try {
      existing = await fs.readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    const want = standardsEnabled() && standardsConfig().get<boolean>('writeEditorConfig', true);

    if (want) {
      const next = upsertSection(existing ?? '', generateSection(currentStandards()));
      if (next === existing) return;
      await fs.writeFile(file, next, 'utf8');
      if (existing === undefined) await this.workspaceState.update(CREATED_KEY, file);
      this.logger.info(`Wrote CodeXStudio coding standards to ${file}.`);
      this.notifyWritten(file);
    } else if (existing !== undefined && hasSection(existing)) {
      const rest = removeSection(existing);
      const createdByUs = this.workspaceState.get<string>(CREATED_KEY) === file;
      if (rest === '' || (createdByUs && isOnlyRootLine(rest))) {
        await fs.unlink(file);
        await this.workspaceState.update(CREATED_KEY, undefined);
        this.logger.info(`Removed ${file} (it only contained CodeXStudio coding standards).`);
      } else {
        await fs.writeFile(file, rest, 'utf8');
        this.logger.info(`Removed the CodeXStudio coding standards section from ${file}.`);
      }
    }
  }

  private notifyWritten(file: string): void {
    if (this.workspaceState.get<boolean>(NOTIFIED_KEY)) return;
    void this.workspaceState.update(NOTIFIED_KEY, true);
    void vscode.window
      .showInformationMessage(
        `CodeXStudio: Coding standards were written to ${vscode.workspace.asRelativePath(file)} so the C# language service, dotnet format and builds enforce them too.`,
        'Open .editorconfig',
      )
      .then(choice => {
        if (choice) void vscode.window.showTextDocument(vscode.Uri.file(file));
      });
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    for (const d of this.disposables) d.dispose();
  }
}
