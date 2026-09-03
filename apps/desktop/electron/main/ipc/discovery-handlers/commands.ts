import { AGENT_COMMAND_CONTEXT } from '@ax-studio/core';
import { ipcHandle } from '../ipc-handle.js';
import { getCore } from '../../core-instance.js';

const agentContext = { executionContext: AGENT_COMMAND_CONTEXT };

function objectArgs(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : {};
}

export function registerDiscoveryCommandHandlers(): void {
  ipcHandle('ax:discoveryStart', async (_event, payload: unknown) => {
    return getCore().commandService.execute({
      name: 'discovery.start',
      args: objectArgs(payload),
    }, agentContext);
  });

  ipcHandle('ax:discoveryInspect', async (_event, sessionId: unknown) => {
    return getCore().commandService.execute({
      name: 'discovery.inspect',
      args: { sessionId },
    });
  });

  ipcHandle('ax:discoveryCancel', async (_event, sessionId: unknown) => {
    return getCore().commandService.execute({
      name: 'discovery.cancel',
      args: { sessionId },
    }, agentContext);
  });

  ipcHandle('ax:discoveryRetry', async (_event, payload: unknown) => {
    return getCore().commandService.execute({
      name: 'discovery.retry',
      args: objectArgs(payload),
    }, agentContext);
  });

  ipcHandle('ax:discoveryAnswer', async (_event, payload: unknown) => {
    return getCore().commandService.execute({
      name: 'discovery.answer',
      args: objectArgs(payload),
    }, agentContext);
  });

  ipcHandle('ax:discoveryPublish', async (_event, payload: unknown) => {
    return getCore().commandService.execute({
      name: 'discovery.publish',
      args: objectArgs(payload),
    }, agentContext);
  });
}
