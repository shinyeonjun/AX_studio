import type { ConnectorContext } from '../modules/types.js';
import type { FileRef } from './artifacts/file-ref.js';
import { resolveDocumentIngestParams } from './mappers.js';
import { resolveIngestPath } from '../runtime/source-resolver.js';

export type DocumentIngestResolveResult =
  | { ok: true; params: Record<string, unknown> }
  | { ok: false; error: string; errorCode: string };

/** Resolve document.ingest params to a physical path + normalized FileRef. */
export function resolveDocumentIngestExecution(
  params: Record<string, unknown>,
  ctx: Pick<ConnectorContext, 'variables' | 'resolveFileRef' | 'connections'>,
): DocumentIngestResolveResult {
  const withInput = resolveDocumentIngestParams(params, ctx.variables);
  const file = withInput.file as FileRef | undefined;
  const path = typeof withInput.path === 'string' ? withInput.path : undefined;

  if (ctx.resolveFileRef && file) {
    const resolved = ctx.resolveFileRef(file);
    if (!resolved.ok) {
      return {
        ok: false,
        error: resolved.error ?? 'source_resolve_failed',
        errorCode: resolved.errorCode ?? 'source_resolve_failed',
      };
    }
    return { ok: true, params: { ...withInput, path: resolved.path, file: resolved.file ?? file } };
  }

  if (path && ctx.connections?.length) {
    const resolved = resolveIngestPath({ path, file }, ctx.connections);
    if (!resolved.ok) {
      return { ok: false, error: resolved.error, errorCode: resolved.errorCode };
    }
    return { ok: true, params: { ...withInput, path: resolved.path, file: resolved.file } };
  }

  if (!path && !file) {
    return { ok: false, error: '문서 입력이 비어 있습니다.', errorCode: 'document_input_required' };
  }

  return { ok: true, params: withInput };
}

export function documentIngestPhysicalPath(params: Record<string, unknown>): string | null {
  const path = typeof params.path === 'string' ? params.path.trim() : '';
  return path || null;
}
