import { ExplorerNode } from '../explorer/solution-tree-item';
import { StartupController } from '../run/startup-controller';
import { SolutionProject } from '../solution/solution-model';
import { CommandContext, registerCommand, requireSolution, resolveProject } from './command-context';

function projectOf(node: unknown): SolutionProject | undefined {
  const n = node as ExplorerNode | undefined;
  return n?.type === 'structure' && n.node.kind === 'project' ? n.node.project : undefined;
}

export function registerRunCommands(ctx: CommandContext, startup: StartupController): void {
  registerCommand(ctx, 'codestudio.setStartupProject', 'Set as Startup Project', async (node?: unknown) => {
    const project = await resolveProject(ctx, node, 'Select the startup project');
    if (project) await startup.setStartup(project);
  });
  registerCommand(ctx, 'codestudio.clearStartupProject', 'Clear Startup Project', async () => {
    requireSolution(ctx);
    await startup.setStartup(undefined);
  });
  registerCommand(ctx, 'codestudio.selectStartupProject', 'Configure Startup Project', async () => {
    requireSolution(ctx);
    return startup.pickStartup();
  });
  registerCommand(ctx, 'codestudio.runStartupProject', 'Start Without Debugging', async (node?: unknown) => {
    requireSolution(ctx);
    return startup.run(projectOf(node));
  });
  registerCommand(ctx, 'codestudio.debugStartupProject', 'Start Debugging', async (node?: unknown) => {
    requireSolution(ctx);
    return startup.debug(projectOf(node));
  });
}
