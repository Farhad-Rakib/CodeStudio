// Launches a downloaded VS Code with CodeStudio loaded and runs ./suite.ts inside the Extension Development Host.
import { existsSync, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  // When launched from a terminal inside VS Code this is inherited and would make the test instance start as plain Node.
  delete process.env.ELECTRON_RUN_AS_NODE;
  const repoRoot = path.resolve(__dirname, '../../..');
  // Work on a copy so restore/build output and CodeStudio metadata (.vscode/.codeStudio-settings) never land in the repo.
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
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: repoRoot,
    extensionTestsPath: path.resolve(__dirname, 'suite'),
    launchArgs: [workspace, '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
  });
}

main().catch(err => {
  console.error('Integration tests failed:', err);
  process.exit(1);
});
