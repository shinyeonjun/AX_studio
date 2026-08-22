import {
  getLocalFolderConnectionStatus,
  type LocalFolderEntry,
} from '../../modules/local-folder/index.js';
import {
  buildLocalFolderResources,
  type ListedFile,
  type LocalFolderResource,
} from '../../modules/local-folder/resources.js';
import type { ConnectionRecord } from '../../design-tools/types.js';

export type { ConnectionRecord, ListedFile, LocalFolderResource };
export { buildLocalFolderResources } from '../../modules/local-folder/resources.js';

export interface ConnectedResourcesSnapshot {
  localFolders: LocalFolderResource[];
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
    // A persisted config can outlive a disconnected connection. Do not scan
    // or expose those paths to an agent until the connector is connected.
    localFolders: status.connected ? buildLocalFolderResources(status.folders, options) : [],
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
  if (pdfCount === 1) {
    lines.push('PDF 1개 → document.ingest params.file에 위 path를 넣으세요. 추측하지 말고 이 목록을 기준으로 사용합니다.');
  } else if (pdfCount > 1) {
    lines.push(`PDF ${pdfCount}개 → goal에 맞는 파일 path를 document.ingest params.file에 넣으세요. 목록이 불확실하면 sources.files.list로 확인하세요.`);
  } else {
    lines.push('PDF 없음 → 처리할 파일이 필요하면 연결 폴더와 파일 조건을 확인하세요.');
  }

  return lines.join('\n');
}
