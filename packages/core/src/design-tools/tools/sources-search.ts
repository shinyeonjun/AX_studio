import { findLocalFolder, parseLocalFolderConnectionConfig } from '../../modules/local-folder/connection.js';
import { citationsFromSearchHits } from '../../platform/citations.js';
import { parseRetrievalIndexConfig } from '../../retrieval/config.js';
import { applySnippetPolicy } from '../../retrieval/snippet-policy.js';
import { searchLocalFolder } from '../../retrieval/search.js';
import type { DesignToolContext, DesignToolHandler } from '../types.js';

function requiredString(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name}_required`);
  return value.trim();
}

function limitArg(args: Record<string, unknown>): number | undefined {
  const value = args.limit;
  if (value === undefined) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) throw new Error('limit_invalid');
  return parsed;
}

/**
 * Local keyword retrieval over connected folders. When the index is disabled,
 * callers should fall back to sources.files.list + sources.file.read.
 */
export const sourcesSearch: DesignToolHandler = async (ctx, args) => {
  const query = requiredString(args, 'query');
  const folderId = typeof args.folderId === 'string' && args.folderId.trim() ? args.folderId.trim() : undefined;
  const limit = limitArg(args);

  const connection = ctx.connections.find((entry) => entry.connector === 'local_folder');
  if (!connection?.connected) throw new Error('local_folder_not_connected');

  const config = parseLocalFolderConnectionConfig(connection.config);
  if (!config) throw new Error('local_folder_not_configured');

  const retrieval = parseRetrievalIndexConfig(connection.config);
  if (!retrieval.enabled) {
    return {
      indexEnabled: false,
      hits: [],
      citations: [],
      fallback: 'sources.files.list',
      note: '로컬 검색 인덱스가 꺼져 있습니다. sources.files.list 후 sources.file.read를 사용하세요.',
    };
  }

  const folder = findLocalFolder(config, folderId);
  if (!folder) throw new Error('folder_not_found');

  const rawHits = searchLocalFolder(folder, query, {
    limit,
    minFileBytes: retrieval.minFileBytes,
    rebuild: true,
  });
  const hits = applySnippetPolicy(rawHits, { allowFullContent: ctx.allowUntrustedData === true });
  const citations = citationsFromSearchHits(hits);

  return {
    indexEnabled: true,
    folderId: folder.id,
    folderLabel: folder.label,
    query,
    hits,
    citations,
    untrusted: true,
    note: '검색 hit는 후보입니다. 본문은 sources.file.read로 확인하세요. 삭제·변경된 파일은 검색에서 제외됩니다.',
  };
};
