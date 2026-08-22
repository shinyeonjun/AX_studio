export interface RetrievalIndexConfig {
  enabled: boolean;
  /** Only index files at or above this size (bytes). Smaller files stay on list/read. */
  minFileBytes: number;
}

export const DEFAULT_RETRIEVAL_INDEX_CONFIG: RetrievalIndexConfig = {
  enabled: false,
  minFileBytes: 16_384,
};

export function parseRetrievalIndexConfig(config: unknown): RetrievalIndexConfig {
  if (!config || typeof config !== 'object') return { ...DEFAULT_RETRIEVAL_INDEX_CONFIG };
  const raw = config as { retrievalIndex?: unknown };
  if (!raw.retrievalIndex || typeof raw.retrievalIndex !== 'object') {
    return { ...DEFAULT_RETRIEVAL_INDEX_CONFIG };
  }
  const entry = raw.retrievalIndex as { enabled?: unknown; minFileBytes?: unknown };
  const minFileBytes =
    typeof entry.minFileBytes === 'number' && Number.isFinite(entry.minFileBytes) && entry.minFileBytes >= 0
      ? Math.floor(entry.minFileBytes)
      : DEFAULT_RETRIEVAL_INDEX_CONFIG.minFileBytes;
  return {
    enabled: entry.enabled === true,
    minFileBytes,
  };
}
