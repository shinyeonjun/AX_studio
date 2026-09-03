import { randomUUID } from 'node:crypto';
import { WorkspaceSourceError } from './contracts.js';

export function assertSessionId(sessionId: string): string {
  const value = sessionId.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new WorkspaceSourceError('invalid_workspace_session');
  return value;
}

export function sourceId(): string {
  return 'src_' + randomUUID().replace(/-/g, '').slice(0, 20);
}

export function errorCode(error: unknown): string {
  const candidate = error instanceof WorkspaceSourceError
    ? error.code
    : error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : (error instanceof Error ? error.message : String(error)).split(':', 1)[0];
  return /^[a-z][a-z0-9_.-]{0,96}$/i.test(candidate)
    ? candidate
    : 'workspace_source_ingest_failed';
}

export function errorMessage(code: string): string {
  if (code === 'document_engine_worker_missing') return '문서 엔진을 찾을 수 없습니다.';
  if (code === 'document_engine_timeout') return '문서 분석 시간이 초과되었습니다.';
  if (code === 'workspace_source_artifact_missing') return '업로드한 원본 파일을 찾을 수 없습니다.';
  return '문서 분석에 실패했습니다.';
}
