import type { IndexDocument } from '../platform/knowledge.js';

export interface IndexedChunk {
  doc: IndexDocument;
  folderId: string;
  filePath: string;
  fileName: string;
  modifiedAt: string;
  size: number;
  text: string;
  tombstone?: boolean;
}
