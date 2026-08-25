import { dialog } from 'electron';
import { ipcHandle } from './ipc-handle.js';
import { getCore } from '../core-instance.js';

function sessionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.trim())) {
    throw new Error('대화 세션 id 형식이 올바르지 않습니다.');
  }
  return value.trim();
}

function optionalSessionId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return sessionId(value);
}

async function pickPdfPath(): Promise<string | undefined> {
  const e2ePath = process.env.AX_E2E === '1' ? process.env.AX_E2E_SOURCE_PATH?.trim() : undefined;
  if (e2ePath) return e2ePath;
  const result = await dialog.showOpenDialog({
    title: '이 대화에 자료 추가',
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return undefined;
  return result.filePaths[0];
}

export function registerWorkspaceSourceHandlers() {
  ipcHandle('ax:listWorkspaceSources', async (_event, rawSessionId: unknown) => {
    return {
      ok: true as const,
      sources: getCore().workspaceSources.list(sessionId(rawSessionId)),
    };
  });

  ipcHandle('ax:attachWorkspaceSource', async (_event, rawSessionId: unknown) => {
    const filePath = await pickPdfPath();
    if (!filePath) {
      return { ok: false as const, canceled: true as const };
    }
    try {
      const attached = await getCore().workspaceSources.attachToSession(
        optionalSessionId(rawSessionId),
        filePath,
        'application/pdf',
      );
      return {
        ok: true as const,
        sessionId: attached.sessionId,
        title: attached.title,
        source: attached.source,
      };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  if (process.env.AX_E2E === '1') {
    ipcHandle('ax:e2eAttachWorkspaceSource', async (
      _event,
      rawSessionId: unknown,
      rawFilePath: unknown,
    ) => {
      if (typeof rawFilePath !== 'string' || !rawFilePath.trim()) {
        throw new Error('E2E 파일 경로가 필요합니다.');
      }
      const attached = await getCore().workspaceSources.attachToSession(
        optionalSessionId(rawSessionId),
        rawFilePath.trim(),
        'application/pdf',
      );
      return {
        ok: true as const,
        sessionId: attached.sessionId,
        title: attached.title,
        source: attached.source,
      };
    });
  }
}
