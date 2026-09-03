import type { Connector } from '../modules/types.js';
import type { WorkflowStore } from '../store/workflow-store.js';
import type { WorkflowIR } from '../workflow/schema.js';
import { inputFromFolder } from './manual-run-input/folder.js';
import { enrichManualRunInput } from './manual-run-input/gmail.js';
import {
  firstActionStep,
  inferExtensions,
  workflowHasDocumentIngest,
  workflowNeedsFilePath,
  workflowNeedsGmailMessageId,
} from './manual-run-input/predicates.js';

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

export {
  enrichManualRunInput,
  firstActionStep,
  workflowHasDocumentIngest,
  workflowNeedsFilePath,
  workflowNeedsGmailMessageId,
};
