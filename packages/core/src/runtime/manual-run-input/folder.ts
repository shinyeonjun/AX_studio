import { findLocalFolder, parseLocalFolderConnectionConfig } from '../../modules/local-folder/connection.js';
import { scanFolderCheckedAsync } from '../../modules/local-folder/scan-async.js';
import type { ScannedFile } from '../../modules/local-folder/scan.js';
import { enrichTriggerPayloadWithFileRef } from '../../contracts/mappers.js';
import type { WorkflowStore } from '../../store/workflow-store.js';

function pickManualRunFile(files: ScannedFile[], extensions?: string[]): ScannedFile | null {
  if (files.length === 0) return null;

  const normalized = extensions?.map((ext) => {
    const trimmed = ext.trim().toLowerCase();
    return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
  });

  const candidates = normalized?.length
    ? files.filter((file) => normalized.includes(file.extension.toLowerCase()))
    : files;
  return [...candidates].sort(
    (left, right) => Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt),
  )[0] ?? null;
}

function folderPayload(
  folder: { id: string; label: string; path: string },
  file: ScannedFile,
): Record<string, unknown> {
  return enrichTriggerPayloadWithFileRef({
    folderId: folder.id,
    folderLabel: folder.label,
    folderPath: folder.path,
    filePath: file.filePath,
    fileName: file.fileName,
    extension: file.extension,
    size: file.size,
    modifiedAt: file.modifiedAt,
  });
}

export async function inputFromFolder(
  store: WorkflowStore,
  folderId: string | undefined,
  folderPath: string | undefined,
  extensions?: string[],
): Promise<Record<string, unknown>> {
  const localFolderConn = store.getConnections().find((entry) => entry.connector === 'local_folder');
  const config = parseLocalFolderConnectionConfig(localFolderConn?.config);
  if (!config?.folders.length) return {};

  const folder = findLocalFolder(config, folderId, folderPath);

  if (folder) {
    const scanned = await scanFolderCheckedAsync(folder.path, extensions);
    if (!scanned.ok) {
      throw Object.assign(new Error(`연결 폴더에 접근할 수 없습니다: ${folder.label}`), {
        code: scanned.errorCode,
      });
    }
    const file = pickManualRunFile(scanned.files, extensions);
    if (file) return folderPayload(folder, file);
    // An explicit folder binding is authoritative. Do not silently switch to
    // another connected folder just because the selected folder is empty.
    if (folderId?.trim() || folderPath?.trim()) return {};
  }

  const matches: Array<{ folder: (typeof config.folders)[number]; file: ScannedFile }> = [];
  const inaccessible: Array<{ label: string; errorCode: string }> = [];
  for (const candidate of config.folders) {
    const scanned = await scanFolderCheckedAsync(candidate.path, extensions);
    if (!scanned.ok) {
      inaccessible.push({ label: candidate.label, errorCode: scanned.errorCode });
      continue;
    }
    const file = pickManualRunFile(scanned.files, extensions);
    if (file) matches.push({ folder: candidate, file });
  }

  if (matches.length === 1) {
    return folderPayload(matches[0]!.folder, matches[0]!.file);
  }

  if (matches.length === 0 && inaccessible.length === 1) {
    const failedFolder = inaccessible[0]!;
    throw Object.assign(new Error(`연결 폴더에 접근할 수 없습니다: ${failedFolder.label}`), {
      code: failedFolder.errorCode,
    });
  }

  // A manual run must never guess which connected folder is the source. The
  // workflow needs an explicit folder binding when more than one source has a
  // matching file; otherwise a valid PDF could be sent to the wrong action.
  return {};
}
