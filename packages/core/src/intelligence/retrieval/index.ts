export { parseRetrievalIndexConfig, DEFAULT_RETRIEVAL_INDEX_CONFIG, type RetrievalIndexConfig } from './config.js';
export { localFileSourceRef } from './file-ref.js';
export { buildFolderIndex, buildSnippet } from './indexer.js';
export { searchLocalFolder, type FolderSearchOptions } from './search.js';
export { applySnippetPolicy, MAX_CLOUD_SNIPPET_CHARS } from './snippet-policy.js';
export { filterFreshChunks, isChunkFresh } from './stale.js';
export {
  clearRetrievalStoreForTests,
  getFolderIndex,
  purgeFolderIndex,
  replaceFolderIndex,
  tombstoneFile,
} from './store.js';
export type { IndexedChunk } from './types.js';
