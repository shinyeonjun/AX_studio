import { findLocalFolder, parseLocalFolderConnectionConfig } from '../modules/local-folder/connection.js';
import { scanFolderCheckedAsync } from '../modules/local-folder/scan-async.js';
import type { ScannedFile } from '../modules/local-folder/scan.js';
import { enrichTriggerPayloadWithFileRef } from '../contracts/mappers.js';
import type { Connector } from '../modules/types.js';
import type { WorkflowStore } from '../store/workflow-store.js';
import type { Step, WorkflowIR } from '../workflow/schema.js';

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

export function workflowHasDocumentIngest(ir: WorkflowIR): boolean {
  return (
    ir.steps?.some(
      (step) => step.type === 'action' && step.connector === 'document' && step.action === 'ingest',
    ) ?? false
  );
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

export function workflowNeedsGmailMessageId(ir: WorkflowIR): boolean {
  if (ir.trigger?.type !== 'gmail.new_message') return false;
  return (
    ir.steps?.some(
      (step) =>
        step.type === 'action' &&
        step.connector === 'gmail' &&
        (step.action === 'messages.read' || step.action === 'message.read'),
    ) ?? false
  );
}

function inferExtensions(ir: WorkflowIR): string[] | undefined {
  if (ir.trigger?.type === 'local_folder.new_file') {
    return ir.trigger.extensions;
  }
  return ['.pdf'];
}

async function inputFromFolder(
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

/** Manual runs do not fire triggers — supply trigger-shaped input from connected resources. */
export async function buildManualRunInput(
  ir: WorkflowIR,
  store: WorkflowStore,
): Promise<Record<string, unknown>> {
  const extensions = inferExtensions(ir);

  if (ir.trigger?.type === 'local_folder.new_file') {
    return inputFromFolder(store, ir.trigger.folderId, ir.trigger.folderPath, extensions);
  }

  if (workflowNeedsFilePath(ir) || workflowHasDocumentIngest(ir)) {
    return inputFromFolder(store, undefined, undefined, extensions);
  }

  return {};
}

/** Manual Gmail-trigger runs use the latest inbox message when no trigger payload exists. */
export async function enrichManualRunInput(
  ir: WorkflowIR,
  connectors: Record<string, Connector>,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!workflowNeedsGmailMessageId(ir)) return input;
  if (typeof input.messageId === 'string' && input.messageId.trim()) return input;

  const gmail = connectors.gmail;
  if (!gmail) return input;

  const result = await gmail.execute(
    'messages.search',
    { query: 'in:inbox newer_than:7d' },
    {
      executionId: 'manual-run-enrich',
      workflowId: ir.id,
      variables: input,
      log: () => {},
    },
  );
  if (!result.ok || !Array.isArray(result.data)) return input;

  const latest = (result.data as Array<{ id?: string }>).find((message) => typeof message.id === 'string');
  if (!latest?.id) return input;

  return {
    ...input,
    messageId: latest.id,
    sender: input.sender ?? input.from ?? '',
    subject: input.subject ?? '',
    snippet: input.snippet ?? '',
  };
}

export function validateManualRunInput(
  ir: WorkflowIR,
  input: Record<string, unknown>,
): { ok: true } | { ok: false; errorCode: string; message: string } {
  if (workflowNeedsGmailMessageId(ir)) {
    const messageId = input.messageId;
    if (typeof messageId !== 'string' || !messageId.trim()) {
      return {
        ok: false,
        errorCode: 'manual_run_input_missing',
        message:
          'Gmail 트리거 업무는 수동 실행 시 최근 받은편지함 메일을 찾지 못했습니다. Gmail 연결을 확인하거나 새 메일 도착 후 트리거로 실행해 주세요.',
      };
    }
  }

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
