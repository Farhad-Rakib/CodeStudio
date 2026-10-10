import { execFile, spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Logger } from '../logger';
import { detectSdk, SdkInfo } from './sdk-detection';

const TASK_SOURCE = 'DotPilot';

/** Runs dotnet as a VS Code task (visible terminal, $msCompile problem matcher) or captured process. */
export class DotnetRunner {
  private sdk: Promise<SdkInfo> | undefined;

  constructor(private readonly logger: Logger) {}

  get dotnetPath(): string {
    return vscode.workspace.getConfiguration('dotpilot').get<string>('dotnetPath')?.trim() || 'dotnet';
  }

  /** Cached SDK detection; a failure is not cached so the user can install the SDK and retry. */
  ensureSdk(): Promise<SdkInfo> {
    if (!this.sdk) {
      this.sdk = detectSdk(this.dotnetPath).then(
        info => {
          this.logger.info(`.NET SDK ${info.version} detected (${info.dotnetPath}).`);
          return info;
        },
        err => {
          this.sdk = undefined;
          throw err;
        },
      );
    }
    return this.sdk;
  }

  resetSdkCache(): void {
    this.sdk = undefined;
  }

  /** Runs `dotnet <args>` as a task. Resolves with the exit code once the process ends. */
  async runTask(label: string, args: string[], cwd: string, targetPath: string): Promise<number | undefined> {
    await this.ensureSdk();
    await assertExists(targetPath);
    this.logger.info(`Task "${label}": ${this.dotnetPath} ${args.join(' ')} (cwd ${cwd})`);

    const task = new vscode.Task(
      { type: 'dotpilot', label, target: targetPath },
      vscode.workspace.getWorkspaceFolder(vscode.Uri.file(targetPath)) ?? vscode.TaskScope.Workspace,
      label,
      TASK_SOURCE,
      new vscode.ProcessExecution(this.dotnetPath, args, { cwd }),
      '$msCompile',
    );
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, clear: true };

    // Subscribe before starting so a very short process cannot finish unobserved.
    let execution: vscode.TaskExecution | undefined;
    const ended = new Map<vscode.TaskExecution, number | undefined>();
    let notify: ((code: number | undefined) => void) | undefined;
    const sub = vscode.tasks.onDidEndTaskProcess(e => {
      if (execution === undefined) ended.set(e.execution, e.exitCode);
      else if (e.execution === execution) notify?.(e.exitCode);
    });
    try {
      execution = await vscode.tasks.executeTask(task);
      const exitCode = ended.has(execution)
        ? ended.get(execution)
        : await new Promise<number | undefined>(resolve => (notify = resolve));
      this.logger.info(`Task "${label}" exited with code ${exitCode}.`);
      return exitCode;
    } finally {
      sub.dispose();
    }
  }

  /** Runs `dotnet <args>` and captures output (used for quick mutating commands like `dotnet add`). */
  async exec(args: string[], cwd: string, timeoutMs = 120000): Promise<{ stdout: string; stderr: string }> {
    await this.ensureSdk();
    this.logger.info(`Exec: ${this.dotnetPath} ${args.join(' ')}`);
    return new Promise((resolve, reject) => {
      execFile(this.dotnetPath, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (stdout.trim()) this.logger.info(stdout.trim());
        if (stderr.trim()) this.logger.warn(stderr.trim());
        if (err) {
          const detail = (stderr.trim() || stdout.trim() || err.message).split(/\r?\n/).slice(-3).join(' ');
          reject(new Error(`dotnet ${args[0]} failed: ${detail}`));
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }
}

/** Runs a process with stdin input and captured output (used by formatters). Never uses a shell. */
export function execWithInput(file: string, args: string[], cwd: string, input: string, timeoutMs = 30000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${file} ${args[0] ?? ''} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', d => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', d => (stderr += d));
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input, 'utf8');
  });
}

async function assertExists(p: string): Promise<void> {
  try {
    await fs.access(p);
  } catch {
    throw new Error(`File not found: ${p}`);
  }
}

export function cwdFor(target: string): string {
  return path.dirname(target);
}
