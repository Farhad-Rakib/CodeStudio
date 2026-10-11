// Launches a downloaded VS Code with CodeXStudio loaded and runs ./suite.ts inside the Extension Development Host.
import { existsSync, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  // When launched from a terminal inside VS Code this is inherited and would make the test instance start as plain Node.
  delete process.env.ELECTRON_RUN_AS_NODE;
  const repoRoot = path.resolve(__dirname, '../../..');
  // Work on a copy so restore/build output and CodeXStudio metadata (.vscode/.codeStudio-settings) never land in the repo.
  // realpath: on macOS os.tmpdir() is under the /var -> /private/var symlink; mixing both spellings makes
  // NuGet restore the same project twice in parallel ("project.assets.json already exists").
  const workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'codestudio-it-')));
  await fs.cp(path.join(repoRoot, 'test', 'fixtures', 'SampleApp'), workspace, {
    recursive: true,
    filter: src => !/[\\/](bin|obj|\.codestudio|\.codeStudio-settings)$/.test(src),
  });
  // Recent macOS builds renamed the binary from "Electron" to "Code"; test-electron 2.x still expects the old name.
  let vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
  const renamed = path.join(path.dirname(vscodeExecutablePath), 'Code');
  if (!existsSync(vscodeExecutablePath) && existsSync(renamed)) vscodeExecutablePath = renamed;
  // `--mssql`: also install Microsoft's SQL Server extension into a dedicated extensions folder and run the
  // suite that drives its dialogs. Opt-in because it downloads the extension and its SQL Tools Service.
  const mssql = process.argv.includes('--mssql');
  let launchArgs = [workspace, '--disable-extensions', '--skip-welcome', '--skip-release-notes'];
  if (mssql) {
    const extensionsDir = path.join(repoRoot, '.vscode-test', 'extensions-mssql');
    const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
    const install = spawnSync(cli, [...cliArgs, '--extensions-dir', extensionsDir, '--install-extension', 'ms-mssql.mssql'], { encoding: 'utf8', stdio: 'inherit' });
    if (install.status !== 0) throw new Error('Installing ms-mssql.mssql failed.');
    launchArgs = [workspace, '--extensions-dir', extensionsDir, '--skip-welcome', '--skip-release-notes'];
  }
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: repoRoot,
    extensionTestsPath: path.resolve(__dirname, mssql ? 'suite-mssql' : 'suite'),
    launchArgs,
  });
}

main().catch(err => {
  console.error('Integration tests failed:', err);
  process.exit(1);
});
