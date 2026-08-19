import { parseLocalFolderConnectionConfig } from '../modules/local-folder/connection.js';
import { scanFolder, type ScannedFile } from '../modules/local-folder/scan.js';
import { enrichTriggerPayloadWithFileRef } from '../contracts/mappers.js';
import type { WorkflowStore } from '../store/workflow-store.js';
import type { Step, WorkflowIR } from '../workflow/schema.js';

function pickManualRunFile(files: ScannedFile[], extensions?: string[]): ScannedFile | null {
  if (files.length === 0) return null;

  const normalized = extensions?.map((ext) => {
    const trimmed = ext.trim().toLowerCase();
    return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
  });

  const pool =
    normalized?.length
      ? files.filter((file) => normalized.includes(file.extension.toLowerCase()))
      : files;

  const candidates = pool.length > 0 ? pool : files;
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

export function workflowNeedsFilePath(ir: WorkflowIR): boolean {
  return (
    ir.steps?.some(
      (step) =>
        step.type === 'action' &&
        step.connector === 'document' &&
        step.action === 'ingest' &&
        typeof step.params?.path === 'string' &&
        step.params.path.includes('filePath'),
    ) ?? false
  );
}

function inferExtensions(ir: WorkflowIR): string[] | undefined {
  if (ir.trigger?.type === 'local_folder.new_file') {
    return ir.trigger.extensions;
  }
  return ['.pdf'];
}

function inputFromFolder(
  store: WorkflowStore,
  folderId: string | undefined,
  extensions?: string[],
): Record<string, unknown> {
  const localFolderConn = store.getConnections().find((entry) => entry.connector === 'local_folder');
  const config = parseLocalFolderConnectionConfig(localFolderConn?.config);
  if (!config?.folders.length) return {};

  const folder =
    (folderId ? config.folders.find((entry) => entry.id === folderId) : undefined) ??
    (config.folders.length === 1 ? config.folders[0] : undefined);

  if (folder) {
    const file = pickManualRunFile(scanFolder(folder.path, extensions), extensions);
    if (file) return folderPayload(folder, file);
  }

  const matches: Array<{ folder: (typeof config.folders)[number]; file: ScannedFile }> = [];
  for (const candidate of config.folders) {
    const file = pickManualRunFile(scanFolder(candidate.path, extensions), extensions);
    if (file) matches.push({ folder: candidate, file });
  }

  if (matches.length === 1) {
    return folderPayload(matches[0]!.folder, matches[0]!.file);
  }

  if (matches.length > 1) {
    const best = [...matches].sort(
      (left, right) => Date.parse(right.file.modifiedAt) - Date.parse(left.file.modifiedAt),
    )[0]!;
    return folderPayload(best.folder, best.file);
  }

  return {};
}

/** Manual runs do not fire triggers — supply trigger-shaped input from connected resources. */
export function buildManualRunInput(
  ir: WorkflowIR,
  store: WorkflowStore,
): Record<string, unknown> {
  const extensions = inferExtensions(ir);

  if (ir.trigger?.type === 'local_folder.new_file') {
    const fromTrigger = inputFromFolder(store, ir.trigger.folderId, extensions);
    if (fromTrigger.filePath) return fromTrigger;
  }

  if (workflowNeedsFilePath(ir)) {
    return inputFromFolder(store, undefined, extensions);
  }

  return {};
}

export function validateManualRunInput(
  ir: WorkflowIR,
  input: Record<string, unknown>,
): { ok: true } | { ok: false; errorCode: string; message: string } {
  if (!workflowNeedsFilePath(ir)) return { ok: true };
  const filePath = input.filePath;
  if (typeof filePath === 'string' && filePath.trim()) return { ok: true };
  return {
    ok: false,
    errorCode: 'manual_run_input_missing',
    message: '연결된 폴더에서 실행할 파일을 찾지 못했습니다. 설정 > 로컬 폴더 연결과 PDF 위치를 확인해 주세요.',
  };
}

export function firstActionStep(ir: WorkflowIR): Extract<Step, { type: 'action' }> | undefined {
  return ir.steps?.find((step): step is Extract<Step, { type: 'action' }> => step.type === 'action');
}
