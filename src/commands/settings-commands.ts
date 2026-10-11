import * as vscode from 'vscode';
import { displayKey, planSettings, PlannedSetting, previewJson, RECOMMENDED_SETTINGS, RecommendedSetting } from '../settings/recommended-settings';
import { CommandContext, registerCommand } from './command-context';

function configFor(s: RecommendedSetting): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(undefined, s.language ? { languageId: s.language } : undefined);
}

function explicitValue(s: RecommendedSetting, target: vscode.ConfigurationTarget): unknown {
  const inspected = configFor(s).inspect(s.key);
  if (!inspected) return undefined;
  if (target === vscode.ConfigurationTarget.Global) return s.language ? inspected.globalLanguageValue : inspected.globalValue;
  return s.language ? inspected.workspaceLanguageValue : inspected.workspaceValue;
}

export function registerSettingsCommands(ctx: CommandContext): void {
  registerCommand(ctx, 'codestudio.applyRecommendedSettings', 'Apply Recommended Settings', async () => {
    const scopes: (vscode.QuickPickItem & { target: vscode.ConfigurationTarget })[] = [
      { label: '$(account) User settings', description: 'Applies to all workspaces', target: vscode.ConfigurationTarget.Global },
    ];
    if (vscode.workspace.workspaceFolders?.length) {
      scopes.push({ label: '$(folder) Workspace settings', description: '.vscode/settings.json', target: vscode.ConfigurationTarget.Workspace });
    }
    const scope = await vscode.window.showQuickPick(scopes, { placeHolder: 'Where should CodeXStudio recommended settings be written?' });
    if (!scope) return;

    const plan = planSettings(RECOMMENDED_SETTINGS, s => explicitValue(s, scope.target)).filter(p => p.status !== 'same');
    if (plan.length === 0) {
      void vscode.window.showInformationMessage('CodeXStudio: All recommended settings are already applied.');
      return;
    }

    const items = plan.map(p => ({
      label: displayKey(p),
      description: `→ ${JSON.stringify(p.value)}`,
      detail: p.status === 'different' ? `$(warning) You set ${JSON.stringify(p.currentValue)}; left unchecked so it is kept. ${p.reason}` : p.reason,
      picked: p.preselected,
      plan: p,
    }));
    const picks = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title: 'CodeXStudio recommended settings',
      placeHolder: 'Review the changes. Settings you already set are unchecked and will not be changed unless you check them.',
      matchOnDetail: true,
    });
    if (!picks?.length) return;
    const selected: PlannedSetting[] = picks.map(p => p.plan);

    for (;;) {
      const overwrites = selected.filter(s => s.status === 'different').length;
      const choice = await vscode.window.showInformationMessage(
        `Apply ${selected.length} setting(s) to ${scope.target === vscode.ConfigurationTarget.Global ? 'User' : 'Workspace'} settings?`,
        { modal: true, detail: overwrites ? `${overwrites} of them replace a value you set yourself.` : 'Only settings you have not set will be added.' },
        'Apply',
        'Preview JSON',
      );
      if (choice === 'Preview JSON') {
        const doc = await vscode.workspace.openTextDocument({ language: 'jsonc', content: `// CodeXStudio: settings that will be written\n${previewJson(selected)}\n` });
        await vscode.window.showTextDocument(doc, { preview: true });
        continue;
      }
      if (choice !== 'Apply') return;
      break;
    }

    for (const s of selected) {
      await configFor(s).update(s.key, s.value, scope.target, s.language ? true : undefined);
      ctx.logger.info(`Applied setting ${displayKey(s)} = ${JSON.stringify(s.value)}`);
    }
    void vscode.window.showInformationMessage(`CodeXStudio: Applied ${selected.length} recommended setting(s).`);
  });
}
