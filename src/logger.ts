import * as vscode from 'vscode';

export class Logger implements vscode.Disposable {
  private readonly channel = vscode.window.createOutputChannel('CodeStudio', { log: true });

  info(message: string): void {
    this.channel.info(message);
  }

  warn(message: string): void {
    this.channel.warn(message);
  }

  error(message: string, err?: unknown): void {
    this.channel.error(err instanceof Error ? `${message}: ${err.stack ?? err.message}` : message);
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }
}

/** Shows an actionable error and logs details. */
export async function reportError(logger: Logger, action: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`${action} failed`, err);
  const choice = await vscode.window.showErrorMessage(`CodeStudio: ${action} failed. ${message}`, 'Show Log');
  if (choice === 'Show Log') logger.show();
}
