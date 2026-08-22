import type { SourceRef } from '../platform/knowledge.js';

export function localFileSourceRef(folderId: string, filePath: string, label?: string): SourceRef {
  const fileName = label ?? filePath.split(/[/\\]/).pop() ?? filePath;
  return {
    connector: 'local_folder',
    kind: 'file',
    id: `${folderId}:${filePath}`,
    label: fileName,
    path: filePath,
  };
}
