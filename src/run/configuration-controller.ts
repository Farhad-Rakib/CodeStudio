import * as vscode from 'vscode';
import { Logger } from '../logger';
import { SolutionManager } from '../solution-manager';
import { BuildConfiguration, configurationKey, configurationLabel } from '../solution/build-configuration';
import { setActiveConfiguration } from '../storage/layout-store';

/**
 * Visual Studio-style "Debug / Release" picker. The selection is stored in the CodeXStudio
 * layout and used by Build, Clean, Test, Run and Debug (Restore does not depend on it).
 */
export class ConfigurationController implements vscode.Disposable {
  // Priority 51 places it just left of the startup project item (50).
  private readonly statusItem = vscode.window.createStatusBarItem('codestudio.configuration', vscode.StatusBarAlignment.Left, 51);
  private readonly disposables: vscode.Disposable[] = [this.statusItem];

  constructor(private readonly manager: SolutionManager, private readonly logger: Logger) {
    this.statusItem.name = 'CodeXStudio Build Configuration';
    this.statusItem.command = 'codestudio.selectConfiguration';
    this.disposables.push(manager.onDidChange(() => this.update()));
    this.update();
  }

  private update(): void {
    const loaded = this.manager.solution;
    const active = this.manager.activeConfiguration;
    if (!loaded || !active) {
      this.statusItem.hide();
      return;
    }
    this.statusItem.text = `$(settings-gear) ${configurationLabel(active, loaded.model.configurations)}`;
    this.statusItem.tooltip = new vscode.MarkdownString(
      `**Build configuration:** ${active.configuration} | ${active.platform}\n\nUsed by Build, Clean, Test, Run and Debug. Click to change.`,
    );
    this.statusItem.show();
  }

  async pick(): Promise<BuildConfiguration | undefined> {
    const loaded = this.manager.solution;
    const active = this.manager.activeConfiguration;
    if (!loaded || !active) throw new Error('No solution is open.');
    const activeKey = configurationKey(active);
    const pick = await vscode.window.showQuickPick(
      loaded.model.configurations.map(c => ({
        label: c.configuration,
        description: c.platform,
        detail: configurationKey(c) === activeKey ? 'Active' : undefined,
        config: c,
      })),
      { title: 'Solution Configuration', placeHolder: 'Which configuration should Build, Test, Run and Debug use?', matchOnDescription: true },
    );
    if (!pick) return undefined;
    await this.set(pick.config);
    return pick.config;
  }

  async set(config: BuildConfiguration): Promise<void> {
    await this.manager.updateLayout(l => setActiveConfiguration(l, configurationKey(config)));
    this.logger.info(`Build configuration set to ${configurationKey(config)}.`);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
