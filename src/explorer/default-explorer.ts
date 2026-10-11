import * as vscode from 'vscode';
import { Logger } from '../logger';

export const SETTING = 'defaultExplorer';
export const ACTIVITY_BAR_VIEW = 'codestudio.solutionExplorer';
export const EXPLORER_VIEW = 'codestudio.solutionExplorer.explorer';

const FILES_HIDDEN_KEY = 'codestudio.filesViewHiddenByCodeStudio';
const NOTIFIED_KEY = 'codestudio.defaultExplorerNotified';

/**
 * Makes Solution Explorer the default explorer: it is shown inside VS Code's Explorer
 * sidebar (instead of the CodeXStudio activity bar container) and the built-in Files view is
 * hidden. Everything CodeXStudio changes is recorded so turning `codestudio.defaultExplorer`
 * off restores VS Code's default layout.
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
    return vscode.workspace.getConfiguration('codestudio').get<boolean>(SETTING, true);
  }

  /** True while CodeXStudio has hidden the built-in Files view. */
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
    const takeOver = this.enabled && this.hasSolution();
    if (takeOver && !this.filesViewHidden) {
      await vscode.commands.executeCommand('workbench.explorer.fileView.removeView');
      await this.globalState.update(FILES_HIDDEN_KEY, true);
      this.logger.info('Solution Explorer is the default explorer; the built-in Files view is hidden.');
      this.notifyOnce();
    } else if (!takeOver && this.filesViewHidden) {
      await this.restoreFilesView();
    }
    if (reveal && this.hasSolution()) {
      await vscode.commands.executeCommand(`${this.activeViewId}.focus`);
    }
  }

  private async restoreFilesView(): Promise<void> {
    // 'open' re-adds the view to the Explorer container if it was removed.
    await vscode.commands.executeCommand('workbench.explorer.fileView.open');
    await this.globalState.update(FILES_HIDDEN_KEY, false);
    this.logger.info('Restored the built-in Files view.');
  }

  private notifyOnce(): void {
    if (this.globalState.get<boolean>(NOTIFIED_KEY)) return;
    void this.globalState.update(NOTIFIED_KEY, true);
    void vscode.window
      .showInformationMessage(
        'CodeXStudio: Solution Explorer is now your default explorer. You can switch back at any time in Settings → CodeXStudio → Default Explorer.',
        'Keep',
        'Restore VS Code Explorer',
      )
      .then(choice => {
        if (choice === 'Restore VS Code Explorer') void this.setEnabled(false);
      });
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
