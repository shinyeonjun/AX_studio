import { MAX_FILES_PER_SCAN } from '../../platform/local-folder-scan.js';

export interface FolderPageOptions {
  offset?: number;
  limit?: number;
}

export function parseFolderPage(offset: unknown = 0, limit: unknown = 100): Required<FolderPageOptions> | null {
  return typeof offset === 'number' && Number.isSafeInteger(offset) && offset >= 0 && offset <= MAX_FILES_PER_SCAN
    && typeof limit === 'number' && Number.isSafeInteger(limit) && limit >= 0 && limit <= MAX_FILES_PER_SCAN
    ? { offset, limit } : null;
}

export function folderPage<T>(scanned: T[], options: Required<FolderPageOptions>) {
  const { offset, limit } = options;
  const files = scanned.slice(offset, offset + limit);
  const scanLimitReached = scanned.length >= MAX_FILES_PER_SCAN;
  const hasMore = offset + files.length < scanned.length;
  const truncated = scanLimitReached || offset > 0 || hasMore;
  return {
    files, offset, limit, totalFileCount: scanned.length,
    totalFileCountIsExact: !scanLimitReached, scanLimitReached, truncated,
    // At the scan ceiling, existence of further files is unknown. Only issue a
    // continuation when this inventory contains an observed next page.
    ...(hasMore ? { hasMore: true } : scanLimitReached ? {} : { hasMore: false }),
    ...(hasMore && files.length > 0 ? { nextOffset: offset + files.length } : {}),
    completeness: {
      status: scanLimitReached ? 'unknown' as const : truncated ? 'partial' as const : 'complete' as const,
      ...(truncated ? { reason: 'provider_limit' as const } : {}),
      observedCount: files.length,
      ...(limit > 0 ? { limit } : {}),
      ...(hasMore ? { hasMore: true } : scanLimitReached ? {} : { hasMore: false }),
    },
  };
}
