import { dialog } from 'electron';
import { ipcHandle } from './ipc-handle.js';
import { getCore } from '../core-instance.js';

function sessionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.trim())) {
    throw new Error('대화 세션 id 형식이 올바르지 않습니다.');
  }
  return value.trim();
}

export function registerWorkspaceSourceHandlers() {
  ipcHandle('ax:listWorkspaceSources', async (_event, rawSessionId: unknown) => {
    return {
      ok: true as const,
      sources: getCore().workspaceSources.list(sessionId(rawSessionId)),
    };
  });

  ipcHandle('ax:attachWorkspaceSource', async (_event, rawSessionId: unknown) => {
    const safeSessionId = sessionId(rawSessionId);
    const result = await dialog.showOpenDialog({
      title: '이 대화에 자료 추가',
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false as const, canceled: true as const };
    }
    try {
      const source = await getCore().workspaceSources.attachFile(
        safeSessionId,
        result.filePaths[0]!,
        'application/pdf',
      );
      return { ok: true as const, source };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
