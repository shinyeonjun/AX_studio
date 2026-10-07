/** Validation output and other structured internals are not a message a person can act on. */
const STRUCTURED_DETAIL = /^\s*[[{]/;
const HANGUL = /[ㄱ-ㆎ가-힣]/u;

const RESTART_APP = '앱 화면을 확인할 수 없어요. 앱을 다시 실행해 주세요.';
const CHAT_SAVE_FAILED = '대화 기록을 저장하지 못했어요. 새로 고친 뒤 다시 시도해 주세요.';
const NOT_READY = '앱이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.';
const OFFLINE = '서버에 연결할 수 없어요. 인터넷 연결과 서버 주소를 확인해 주세요.';

/**
 * Codes the caller classifies itself (it matches them with `includes` and shows its own
 * Korean explanation), so they must survive cleaning unchanged.
 */
const CALLER_CLASSIFIED_CODES = new Set([
  'workspace_chat_revision_conflict',
  'workspace_chat_turn_conflict',
  'workspace_chat_persisted_reply_identity_conflict',
]);

/** Machine codes and English messages the main process can send, in words a person can act on. */
const KNOWN_MESSAGES = new Map<string, string>(Object.entries({
  app_shutting_down: '앱을 종료하는 중이에요. 앱을 다시 실행한 뒤 시도해 주세요.',
  untrusted_ipc_sender: RESTART_APP,
  untrusted_ipc_frame: RESTART_APP,
  main_window_unavailable: RESTART_APP,
  workspace_chat_not_found: '대화를 찾을 수 없어요. 이미 삭제됐을 수 있어요.',
  workspace_chat_too_large: '대화가 너무 길어 저장하지 못했어요. 새 대화를 시작해 주세요.',
  workspace_chat_invalid_turn_id: CHAT_SAVE_FAILED,
  workspace_chat_duplicate_turn_id: CHAT_SAVE_FAILED,
  workspace_chat_invalid_save_options: CHAT_SAVE_FAILED,
  workspace_chat_invalid_lane: CHAT_SAVE_FAILED,
  invalid_workspace_chat_json: CHAT_SAVE_FAILED,
  invalid_workspace_chat_messages: CHAT_SAVE_FAILED,
  workflow_not_found: '업무를 찾을 수 없어요. 이미 삭제됐을 수 있어요.',
  'workflow not found': '업무를 찾을 수 없어요. 이미 삭제됐을 수 있어요.',
  'execution not found': '실행 기록을 찾을 수 없어요. 이미 삭제됐을 수 있어요.',
  'approval not found': '승인 요청을 찾을 수 없어요. 화면을 새로 고쳐 주세요.',
  'approval is already being processed or resolved': '이미 처리된 승인이에요. 화면을 새로 고쳐 주세요.',
  'invalid execution id': '실행 기록을 찾을 수 없어요. 화면을 새로 고쳐 주세요.',
  'invalid approval id': '승인 요청을 찾을 수 없어요. 화면을 새로 고쳐 주세요.',
  'ax studio core is not initialized': NOT_READY,
  'desktop ax data paths are not initialized': NOT_READY,
  'failed to fetch': OFFLINE,
  'fetch failed': OFFLINE,
  econnrefused: OFFLINE,
  econnreset: OFFLINE,
  enotfound: OFFLINE,
  etimedout: '응답이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.',
  enoent: '파일이나 폴더를 찾을 수 없어요. 옮겨지거나 삭제됐는지 확인해 주세요.',
  eacces: '파일이나 폴더에 접근할 권한이 없어요.',
  eperm: '파일이나 폴더에 접근할 권한이 없어요.',
  ebusy: '다른 프로그램이 파일을 사용 중이에요. 그 프로그램을 닫고 다시 시도해 주세요.',
  enospc: '저장 공간이 부족해요. 디스크 공간을 확보한 뒤 다시 시도해 주세요.',
}));

/** Node error codes often arrive as "ENOENT: no such file…"; look the code up on its own. */
const NODE_ERROR_CODE = /^(E[A-Z]{3,})\b/;

function cleanIpcError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^\w*Error:\s*/, '')
    .trim();
}

/** The cleaned message without translation, for code that branches on machine codes. */
export function ipcErrorCode(error: unknown): string {
  return cleanIpcError(error);
}

/**
 * The text to show a person for a failed request. Korean messages from the main process pass
 * through; known codes and English messages are translated; anything else becomes `fallback`.
 */
export function ipcErrorMessage(error: unknown, fallback = '요청 처리에 실패했습니다.'): string {
  const message = cleanIpcError(error);
  if (!message || STRUCTURED_DETAIL.test(message)) return fallback;
  if (CALLER_CLASSIFIED_CODES.has(message)) return message;
  // Codes first: a system error naming a Korean file path (ENOENT … 업무자료 …) is not Korean text.
  const key = message.replace(/[.!\s]+$/u, '').toLowerCase();
  const nodeCode = NODE_ERROR_CODE.exec(message)?.[1]?.toLowerCase();
  const known = KNOWN_MESSAGES.get(key) ?? (nodeCode ? KNOWN_MESSAGES.get(nodeCode) : undefined);
  if (known) return known;
  if (nodeCode) return fallback;
  return HANGUL.test(message) ? message : fallback;
}
