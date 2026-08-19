import type { FileRef } from './artifacts/file-ref.js';
import { fileRefFromLocalScan } from './artifacts/file-ref.js';
import { documentIngestPath, type DocumentIngestInput } from './artifacts/document.js';

/** Trigger / manual-run payload shape from local_folder.new_file. */
export function fileRefFromTriggerPayload(payload: Record<string, unknown>): FileRef | undefined {
  const filePath = payload.filePath;
  if (typeof filePath !== 'string' || !filePath.trim()) return undefined;

  return fileRefFromLocalScan({
    folderId: typeof payload.folderId === 'string' ? payload.folderId : undefined,
    folderPath: typeof payload.folderPath === 'string' ? payload.folderPath : undefined,
    filePath: filePath.trim(),
    fileName:
      typeof payload.fileName === 'string' && payload.fileName.trim()
        ? payload.fileName.trim()
        : filePath.split(/[/\\]/).pop() ?? filePath,
    extension: typeof payload.extension === 'string' ? payload.extension : undefined,
    size: typeof payload.size === 'number' ? payload.size : undefined,
    modifiedAt: typeof payload.modifiedAt === 'string' ? payload.modifiedAt : undefined,
  });
}

export function fileRefFromExecutionVariables(variables: Record<string, unknown>): FileRef | undefined {
  if (variables.fileRef && typeof variables.fileRef === 'object') {
    const candidate = variables.fileRef as Record<string, unknown>;
    if (typeof candidate.path === 'string' && candidate.path.trim()) {
      return fileRefFromLocalScan({
        folderId: typeof candidate.folderId === 'string' ? candidate.folderId : undefined,
        folderPath: typeof candidate.folderPath === 'string' ? candidate.folderPath : undefined,
        filePath: candidate.path,
        fileName:
          typeof candidate.name === 'string'
            ? candidate.name
            : candidate.path.split(/[/\\]/).pop() ?? candidate.path,
        extension: typeof candidate.extension === 'string' ? candidate.extension : undefined,
        size: typeof candidate.size === 'number' ? candidate.size : undefined,
        modifiedAt: typeof candidate.modifiedAt === 'string' ? candidate.modifiedAt : undefined,
      });
    }
  }

  return fileRefFromTriggerPayload(variables);
}

export function documentIngestParamsFromFileRef(file: FileRef): { path: string } {
  return { path: file.path };
}

export function documentIngestParamsFromInput(input: DocumentIngestInput): { path: string } | undefined {
  const path = documentIngestPath(input);
  return path ? { path } : undefined;
}

/** Merge template-resolved params with contract-derived document.ingest path. */
export function resolveDocumentIngestParams(
  params: Record<string, unknown>,
  variables: Record<string, unknown>,
): Record<string, unknown> {
  const path = params.path;
  if (typeof path === 'string' && path.trim() && !path.includes('{{')) {
    return params;
  }

  const file = fileRefFromExecutionVariables(variables);
  if (!file) return params;

  const mapped = documentIngestParamsFromFileRef(file);
  return { ...params, path: mapped.path };
}

/** Keep trigger-shaped payload while attaching normalized FileRef for downstream contracts. */
export function enrichTriggerPayloadWithFileRef(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const file = fileRefFromTriggerPayload(payload);
  if (!file) return payload;
  return { ...payload, fileRef: file };
}
