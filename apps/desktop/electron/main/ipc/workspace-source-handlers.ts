import { app, dialog } from 'electron';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { ipcHandle } from './ipc-handle.js';
import { getCore } from '../core-instance.js';

let e2eSourcePath: string | undefined;

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

function validateE2ePdfPath(filePath: string): string {
  if (extname(filePath).toLowerCase() !== '.pdf' || !existsSync(filePath)) {
    throw new Error('E2E PDF fixture를 찾을 수 없습니다.');
  }

  try {
    const fixtureRoot = realpathSync(resolve(process.cwd(), 'test', 'fixtures'));
    const resolvedFilePath = realpathSync(filePath);
    const relativeFilePath = relative(fixtureRoot, resolvedFilePath);
    const isInsideFixtureRoot = relativeFilePath !== ''
      && relativeFilePath !== '..'
      && !relativeFilePath.startsWith(`..${sep}`)
      && !isAbsolute(relativeFilePath);
    if (!isInsideFixtureRoot || !statSync(resolvedFilePath).isFile()) {
      throw new Error('E2E PDF fixture를 찾을 수 없습니다.');
    }
    return resolvedFilePath;
  } catch (error) {
    if (error instanceof Error && error.message === 'E2E PDF fixture를 찾을 수 없습니다.') throw error;
    throw new Error('E2E PDF fixture를 찾을 수 없습니다.');
  }
}

async function pickPdfPath(): Promise<string | undefined> {
  const e2ePath = process.env.AX_E2E === '1'
    ? process.env.AX_E2E_SOURCE_PATH?.trim() || e2eSourcePath
    : undefined;
  e2eSourcePath = undefined;
  if (e2ePath) return validateE2ePdfPath(e2ePath);
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

  if (process.env.AX_E2E === '1' && !app.isPackaged) {
    ipcHandle('ax:e2eSetWorkspaceSourcePath', async (_event, rawFilePath: unknown) => {
      if (typeof rawFilePath !== 'string' || !rawFilePath.trim()) {
        throw new Error('E2E 파일 경로가 필요합니다.');
      }
      const filePath = rawFilePath.trim();
      e2eSourcePath = validateE2ePdfPath(filePath);
      return { ok: true as const };
    });
  }
}
