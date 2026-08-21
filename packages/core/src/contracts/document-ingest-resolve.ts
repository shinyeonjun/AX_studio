import type { ConnectorContext } from '../modules/types.js';
import type { FileRef } from './artifacts/file-ref.js';
import { fileRefFromExecutionVariables, resolveDocumentIngestParams } from './mappers.js';
import { resolveIngestPath } from '../runtime/source-resolver.js';

export type DocumentIngestResolveResult =
  | { ok: true; params: Record<string, unknown> }
  | { ok: false; error: string; errorCode: string };

function ingestCandidates(
  params: Record<string, unknown>,
  variables: Record<string, unknown>,
): Array<{ path?: string; file?: FileRef }> {
  const primary = resolveDocumentIngestParams(params, variables);
  const fallbackFile = fileRefFromExecutionVariables(variables);
  const fallbackPath = typeof variables.filePath === 'string' ? variables.filePath : undefined;
  const seen = new Set<string>();
  const candidates: Array<{ path?: string; file?: FileRef }> = [];

  const push = (path?: string, file?: FileRef) => {
    const key = file?.path ?? path ?? '';
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push({ path, file });
  };

  push(
    typeof primary.path === 'string' ? primary.path : undefined,
    primary.file as FileRef | undefined,
  );
  push(fallbackPath, fallbackFile);
  return candidates;
}

/** Resolve document.ingest params to a physical path + normalized FileRef. */
export function resolveDocumentIngestExecution(
  params: Record<string, unknown>,
  ctx: Pick<ConnectorContext, 'variables' | 'resolveFileRef' | 'connections'>,
): DocumentIngestResolveResult {
  const hasConnectedLocalFolder = (ctx.connections ?? []).some(
    (connection) => connection.connector === 'local_folder' && connection.connected,
  );
  if (!hasConnectedLocalFolder) {
    return {
      ok: false,
      error: 'local_folder_not_connected',
      errorCode: 'local_folder_not_connected',
    };
  }

  const withInput = resolveDocumentIngestParams(params, ctx.variables);
  const candidates = ingestCandidates(params, ctx.variables);
  let lastError: { error: string; errorCode: string } | undefined;

  for (const candidate of candidates) {
    if (ctx.resolveFileRef && candidate.file) {
      const resolved = ctx.resolveFileRef(candidate.file);
      if (resolved.ok && resolved.path) {
        return {
          ok: true,
          params: { ...withInput, path: resolved.path, file: resolved.file ?? candidate.file },
        };
      }
      lastError = {
        error: resolved.error ?? 'source_resolve_failed',
        errorCode: resolved.errorCode ?? 'source_resolve_failed',
      };
    }

    const path = candidate.path ?? candidate.file?.path;
    if (path && ctx.connections?.length) {
      const resolved = resolveIngestPath({ path, file: candidate.file }, ctx.connections);
      if (resolved.ok) {
        return { ok: true, params: { ...withInput, path: resolved.path, file: resolved.file } };
      }
      lastError = { error: resolved.error, errorCode: resolved.errorCode };
    }
  }

  if (lastError) {
    return { ok: false, error: lastError.error, errorCode: lastError.errorCode };
  }

  if (!withInput.path && !withInput.file) {
    return { ok: false, error: '문서 입력이 비어 있습니다.', errorCode: 'document_input_required' };
  }

  return { ok: true, params: withInput };
}

export function documentIngestPhysicalPath(params: Record<string, unknown>): string | null {
  const path = typeof params.path === 'string' ? params.path.trim() : '';
  return path || null;
}
