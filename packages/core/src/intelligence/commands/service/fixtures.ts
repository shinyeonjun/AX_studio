import type { AxCommandResult, AxUiPresentation } from '../schema.js';
import type { AxCommandService } from '../service.js';
import type { AxCommandExecuteOptions } from './contracts.js';

export const commandChatContext = { executionContext: { origin: 'agent' as const } };

/** Agent mutations are proposed first; this confirms them through the host card token like the desktop host does. */
export async function executeConfirmedMutation(
  service: AxCommandService,
  command: unknown,
  options: AxCommandExecuteOptions,
): Promise<AxCommandResult> {
  const sessionOptions = { workspaceSessionId: 'fixture-session', ...options };
  const proposed = await service.execute(command, sessionOptions);
  if (proposed.status !== 'needs_input') return proposed;
  const presentation = (proposed.data as { presentation?: AxUiPresentation } | undefined)?.presentation;
  const action = presentation?.actions.find((entry) => entry.purpose === 'confirm_mutation');
  if (!action) return proposed;
  return service.execute({ name: 'mutation.commit', args: {} }, {
    ...sessionOptions,
    mutationConfirmationToken: action.id.slice('confirm_mutation:'.length),
  });
}
