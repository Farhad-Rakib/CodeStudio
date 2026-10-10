import { execFile } from 'child_process';

export interface SdkInfo {
  readonly dotnetPath: string;
  readonly version: string;
  readonly sdks: readonly { version: string; location: string }[];
}

export class SdkNotFoundError extends Error {
  constructor(readonly dotnetPath: string, cause: string) {
    super(`The .NET SDK was not found ('${dotnetPath}': ${cause}). Install it from https://dot.net or set "codestudio.dotnetPath".`);
    this.name = 'SdkNotFoundError';
  }
}

function run(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: process.env.DOTNET_CLI_TELEMETRY_OPTOUT ?? '1', DOTNET_NOLOGO: '1' } },
      (err, stdout, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout)));
  });
}

export function parseListSdks(output: string): { version: string; location: string }[] {
  const result: { version: string; location: string }[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /^(\S+)\s+\[(.+)\]\s*$/.exec(line.trim());
    if (m) result.push({ version: m[1], location: m[2] });
  }
  return result;
}

/** Detects the SDK via `dotnet --version` and `dotnet --list-sdks`, without blocking the extension host. */
export async function detectSdk(dotnetPath: string): Promise<SdkInfo> {
  let version: string;
  try {
    version = (await run(dotnetPath, ['--version'], 15000)).trim();
  } catch (err) {
    throw new SdkNotFoundError(dotnetPath, (err as Error).message);
  }
  if (!/^\d+\.\d+/.test(version)) throw new SdkNotFoundError(dotnetPath, `unexpected version output "${version}"`);
  let sdks: { version: string; location: string }[] = [];
  try {
    sdks = parseListSdks(await run(dotnetPath, ['--list-sdks'], 15000));
  } catch {
    // --list-sdks is informational only.
  }
  return { dotnetPath, version, sdks };
}
