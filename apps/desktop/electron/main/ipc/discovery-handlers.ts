import { ipcHandle } from './ipc-handle.js';
import { getCore } from '../core-instance.js';
import { ArtifactStore, getAxDataPaths, importDiscoveryArtifact, AGENT_COMMAND_CONTEXT } from '@ax-studio/core';
import { join } from 'node:path';
import { dialog } from 'electron';

const agentContext = { executionContext: AGENT_COMMAND_CONTEXT };

function artifactStore() {
  return new ArtifactStore(join(getAxDataPaths().root, 'artifacts'));
}

export function registerDiscoveryHandlers() {
  ipcHandle('ax:importArtifact', async () => {
    const result = await dialog.showOpenDialog({
      title: '지난 결과물 선택',
      properties: ['openFile'],
      filters: [
        { name: 'Documents', extensions: ['pdf', 'csv', 'xlsx', 'xls'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false as const, canceled: true as const };
    }
    try {
      const stored = await importDiscoveryArtifact(artifactStore(), result.filePaths[0]!);
      return { ok: true as const, artifact: stored };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcHandle('ax:discoveryStart', async (_event, payload: unknown) => {
    const core = getCore();
    const args =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)
        : {};
    return core.commandService.execute({
      name: 'discovery.start',
      args,
    }, agentContext);
  });

  ipcHandle('ax:discoveryInspect', async (_event, sessionId: unknown) => {
    const core = getCore();
    return core.commandService.execute({
      name: 'discovery.inspect',
      args: { sessionId },
    });
  });

  ipcHandle('ax:discoveryCancel', async (_event, sessionId: unknown) => {
    const core = getCore();
    return core.commandService.execute({
      name: 'discovery.cancel',
      args: { sessionId },
    }, agentContext);
  });

  ipcHandle('ax:discoveryAnswer', async (_event, payload: unknown) => {
    const core = getCore();
    const args =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)
        : {};
    return core.commandService.execute({
      name: 'discovery.answer',
      args,
    }, agentContext);
  });

  ipcHandle('ax:discoveryPublish', async (_event, payload: unknown) => {
    const core = getCore();
    const args =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)
        : {};
    return core.commandService.execute({
      name: 'discovery.publish',
      args,
    }, agentContext);
  });
}
