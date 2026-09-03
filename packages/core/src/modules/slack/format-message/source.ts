import type { FileRef } from '../../../contracts/artifacts/file-ref.js';
import type { ConnectorContext } from '../../types.js';

export interface SlackMessageSource {
  fileName?: string;
  folderLabel?: string;
  engine?: string;
}

export function resolveSlackMessageSource(ctx: ConnectorContext): SlackMessageSource {
  const fileRef = ctx.variables.fileRef;
  const parsedFileRef =
    fileRef && typeof fileRef === 'object' ? (fileRef as Partial<FileRef>) : undefined;

  const fileName =
    (typeof ctx.variables.fileName === 'string' && ctx.variables.fileName.trim()) ||
    (typeof parsedFileRef?.name === 'string' && parsedFileRef.name.trim()) ||
    undefined;

  const folderLabel =
    (typeof ctx.variables.folderLabel === 'string' && ctx.variables.folderLabel.trim()) ||
    (typeof parsedFileRef?.folderId === 'string' && parsedFileRef.folderId.trim()) ||
    undefined;

  const summary = ctx.variables.axDocumentSummary;
  const engine =
    summary &&
    typeof summary === 'object' &&
    typeof (summary as Record<string, unknown>).engine === 'string'
      ? String((summary as Record<string, unknown>).engine)
      : typeof ctx.variables.documentEngine === 'string'
        ? ctx.variables.documentEngine
        : undefined;

  return { fileName, folderLabel, engine };
}

export function formatSlackSourceLine(source: SlackMessageSource): string | undefined {
  const parts: string[] = [];
  if (source.fileName) parts.push(source.fileName);
  if (source.folderLabel) parts.push(source.folderLabel);
  if (source.engine) parts.push(source.engine);
  if (parts.length === 0) return undefined;
  return `_출처 · ${parts.join(' · ')}_`;
}
