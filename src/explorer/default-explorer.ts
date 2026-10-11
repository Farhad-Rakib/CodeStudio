import * as vscode from 'vscode';
import { Logger } from '../logger';

export const SETTING = 'defaultExplorer';
export const ACTIVITY_BAR_VIEW = 'codestudio.solutionExplorer';
export const EXPLORER_VIEW = 'codestudio.solutionExplorer.explorer';

/** Set by CodeXStudio 0.1.0, which tried to hide the built-in Files view; cleared once it is shown again. */
const FILES_HIDDEN_KEY = 'codestudio.filesViewHiddenByCodeStudio';

/**
 * Chooses where Solution Explorer appears: its own CodeXStudio container in the Activity Bar
 * (default), or VS Code's Explorer sidebar when `codestudio.defaultExplorer` is on. CodeXStudio
 * never hides the built-in Files view: VS Code does not let extensions hide or reorder it
 * (`workbench.explorer.fileView.removeView` is a no-op for extensions since VS Code 1.141).
 */
export class DefaultExplorerController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private syncing: Promise<void> = Promise.resolve();

  constructor(
    private readonly globalState: vscode.Memento,
    private readonly logger: Logger,
    private readonly hasSolution: () => boolean,
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(`codestudio.${SETTING}`)) void this.sync(true);
      }),
    );
  }

  get enabled(): boolean {
    return vscode.workspace.getConfiguration('codestudio').get<boolean>(SETTING, false);
  }

  /** True only while a Files view hidden by CodeXStudio 0.1.0 has not been restored yet. */
  get filesViewHidden(): boolean {
    return this.globalState.get<boolean>(FILES_HIDDEN_KEY, false);
  }

  /** Visible Solution Explorer view id for the current mode. */
  get activeViewId(): string {
    return this.enabled ? EXPLORER_VIEW : ACTIVITY_BAR_VIEW;
  }

  /** Writes the setting where the user's effective value lives (workspace if set there, else user). */
  async setEnabled(value: boolean): Promise<void> {
    const config = vscode.workspace.getConfiguration('codestudio');
    const inspected = config.inspect<boolean>(SETTING);
    const target = inspected?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await config.update(SETTING, value, target);
    // onDidChangeConfiguration triggers sync(); wait for it so callers observe the final state.
    await this.sync(true);
  }

  /**
   * Applies or reverts the layout. Serialized so rapid config changes cannot interleave.
   * `reveal` focuses Solution Explorer after switching modes.
   */
  sync(reveal = false): Promise<void> {
    this.syncing = this.syncing.then(() => this.doSync(reveal)).catch(err => this.logger.error('Default explorer sync failed', err));
    return this.syncing;
  }

  private async doSync(reveal: boolean): Promise<void> {
    // Undo what CodeXStudio 0.1.0 may have done in older VS Code versions, once.
    if (this.filesViewHidden) await this.restoreFilesView();
    if (reveal && this.hasSolution()) {
      await vscode.commands.executeCommand(`${this.activeViewId}.focus`);
    }
  }

  private async restoreFilesView(): Promise<void> {
    // 'open' re-adds the view to the Explorer container if it was removed.
    await vscode.commands.executeCommand('workbench.explorer.fileView.open');
    await this.globalState.update(FILES_HIDDEN_KEY, false);
    this.logger.info('Restored the built-in Files view hidden by an earlier CodeXStudio version.');
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
