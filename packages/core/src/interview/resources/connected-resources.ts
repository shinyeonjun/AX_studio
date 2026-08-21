import {
  getLocalFolderConnectionStatus,
  scanFolder,
  type LocalFolderEntry,
} from '../../modules/local-folder/index.js';
import { resolveFolderRoot } from '../../modules/local-folder/path-security.js';
import type { ConnectionRecord } from '../../design-tools/types.js';

export type { ConnectionRecord };

export interface ListedFile {
  filePath: string;
  fileName: string;
  extension: string;
}

export interface LocalFolderResource {
  id: string;
  label: string;
  path: string;
  accessible: boolean;
  files: ListedFile[];
  totalFileCount: number;
  truncated: boolean;
}

export interface ConnectedResourcesSnapshot {
  localFolders: LocalFolderResource[];
}

const DEFAULT_MAX_FILES_PER_FOLDER = 40;

function toListedFile(file: { filePath: string; fileName: string; extension: string }): ListedFile {
  return { filePath: file.filePath, fileName: file.fileName, extension: file.extension };
}

export function buildLocalFolderResources(
  folders: LocalFolderEntry[],
  options?: { maxFilesPerFolder?: number; extensions?: string[] },
): LocalFolderResource[] {
  const maxFiles = options?.maxFilesPerFolder ?? DEFAULT_MAX_FILES_PER_FOLDER;
  const extensions = options?.extensions;

  return folders.map((folder) => {
    const access = resolveFolderRoot(folder.path);
    const scanned = scanFolder(folder.path, extensions);
    const truncated = scanned.length > maxFiles;
    const files = (truncated ? scanned.slice(0, maxFiles) : scanned).map(toListedFile);
    return {
      id: folder.id,
      label: folder.label,
      path: folder.path,
      accessible: access.ok,
      files,
      totalFileCount: scanned.length,
      truncated,
    };
  });
}

export function buildConnectedResourcesFromConnections(
  connections: ConnectionRecord[],
  options?: { maxFilesPerFolder?: number },
): ConnectedResourcesSnapshot {
  const localFolderConn = connections.find((entry) => entry.connector === 'local_folder');
  const status = getLocalFolderConnectionStatus(
    localFolderConn?.config,
    Boolean(localFolderConn?.connected),
  );
  return {
    localFolders: buildLocalFolderResources(status.folders, options),
  };
}

export interface ListedFileRef extends ListedFile {
  folderId: string;
}

export function findSinglePdfInResources(resources: ConnectedResourcesSnapshot): ListedFileRef | null {
  const pdfs: ListedFileRef[] = [];
  for (const folder of resources.localFolders) {
    for (const file of folder.files) {
      if (file.extension.toLowerCase() === '.pdf') {
        pdfs.push({ ...file, folderId: folder.id });
      }
    }
  }
  return pdfs.length === 1 ? pdfs[0]! : null;
}

export function formatConnectedResourcesForPrompt(snapshot: ConnectedResourcesSnapshot | undefined): string {
  if (!snapshot?.localFolders.length) {
    return '(연결된 로컬 폴더 없음 — 설정 > 저장소 > 로컬 폴더에서 연결하세요)';
  }

  const lines: string[] = [];
  let pdfCount = 0;
  for (const folder of snapshot.localFolders) {
    const status = folder.accessible ? 'accessible' : 'inaccessible — reconnect required';
    lines.push(`- folderId=${folder.id} label="${folder.label}" path="${folder.path}" status=${status}`);
    if (folder.files.length === 0) {
      lines.push('  files: (없음)');
      continue;
    }
    const suffix = folder.truncated ? ` (상위 ${folder.files.length}/${folder.totalFileCount}개만 표시)` : '';
    lines.push(`  files${suffix}:`);
    for (const file of folder.files) {
      if (file.extension.toLowerCase() === '.pdf') pdfCount += 1;
      lines.push(`    - ${file.fileName} (${file.extension || 'no-ext'}) path="${file.filePath}"`);
    }
  }

  lines.push('');
  const inaccessibleCount = snapshot.localFolders.filter((folder) => !folder.accessible).length;
  if (inaccessibleCount > 0) {
    lines.push(`접근 불가 폴더 ${inaccessibleCount}개 확인됨 → 해당 폴더는 workflow 대상으로 선택하지 말고 설정에서 다시 연결하세요.`);
  }
  if (pdfCount > 0) {
    lines.push(`PDF ${pdfCount}개 확인됨 → 이 목록의 파일을 처리 대상으로 사용할 수 있습니다.`);
  } else {
    lines.push('PDF 없음 → 처리할 파일이 필요하면 연결 폴더와 파일 조건을 확인하세요.');
  }

  return lines.join('\n');
}
