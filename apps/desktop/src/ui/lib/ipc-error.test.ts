import { describe, expect, it } from 'vitest';
import { ipcErrorCode, ipcErrorMessage } from './ipc-error';

describe('the error a person sees from a failed request', () => {
  it('keeps a readable message and drops the IPC wrapper', () => {
    expect(ipcErrorMessage(new Error("Error invoking remote method 'ax:x': Error: 폴더를 찾을 수 없습니다."))).toBe('폴더를 찾을 수 없습니다.');
    expect(ipcErrorMessage(new Error('Error: 연결 실패'))).toBe('연결 실패');
  });

  it('never shows validation output or other internals', () => {
    const zod = `Error invoking remote method 'ax:discoveryPublish': [ { "code": "too_big", "path": ["outputContract"] } ]`;
    expect(ipcErrorMessage(new Error(zod), '저장하지 못했습니다.')).toBe('저장하지 못했습니다.');
    expect(ipcErrorMessage(new Error(`Error invoking remote method 'ax:y': ZodError: [{"code":"x"}]`))).toBe('요청 처리에 실패했습니다.');
  });
});

describe('English and code-like errors from the main process', () => {
  const wrap = (message: string) => new Error(`Error invoking remote method 'ax:x': Error: ${message}`);

  it('translates known machine codes into Korean a person can act on', () => {
    expect(ipcErrorMessage(wrap('app_shutting_down'))).toBe('앱을 종료하는 중이에요. 앱을 다시 실행한 뒤 시도해 주세요.');
    expect(ipcErrorMessage(wrap('untrusted_ipc_sender'))).toBe('앱 화면을 확인할 수 없어요. 앱을 다시 실행해 주세요.');
    expect(ipcErrorMessage(wrap('workspace_chat_invalid_turn_id'))).toBe('대화 기록을 저장하지 못했어요. 새로 고친 뒤 다시 시도해 주세요.');
  });

  it('translates known English messages regardless of case or trailing punctuation', () => {
    expect(ipcErrorMessage(wrap('Workflow not found'))).toBe('업무를 찾을 수 없어요. 이미 삭제됐을 수 있어요.');
    expect(ipcErrorMessage(wrap('Approval is already being processed or resolved.'))).toBe('이미 처리된 승인이에요. 화면을 새로 고쳐 주세요.');
    expect(ipcErrorMessage(wrap('AX Studio core is not initialized'))).toBe('앱이 아직 준비되지 않았어요. 잠시 후 다시 시도해 주세요.');
  });

  it('reads a Node error code at the start of a system message', () => {
    expect(ipcErrorMessage(wrap("ENOENT: no such file or directory, open 'C:\\x.pdf'"))).toBe('파일이나 폴더를 찾을 수 없어요. 옮겨지거나 삭제됐는지 확인해 주세요.');
  });

  it("shows the caller's Korean fallback for any other English or code-like text", () => {
    expect(ipcErrorMessage(wrap('some_internal_code'), '저장하지 못했어요.')).toBe('저장하지 못했어요.');
    expect(ipcErrorMessage(wrap('Cannot read properties of undefined (reading "id")'), '불러오지 못했어요.')).toBe('불러오지 못했어요.');
    expect(ipcErrorMessage(wrap('constructor'), '불러오지 못했어요.')).toBe('불러오지 못했어요.');
    expect(ipcErrorMessage('plain string failure')).toBe('요청 처리에 실패했습니다.');
  });

  it('keeps Korean messages even when they mention a product name in English', () => {
    expect(ipcErrorMessage(wrap('Slack 연결에 실패했어요.'))).toBe('Slack 연결에 실패했어요.');
  });

  it('keeps conflict codes the caller recognises itself, and exposes the raw code for branching', () => {
    expect(ipcErrorMessage(wrap('workspace_chat_turn_conflict'))).toContain('workspace_chat_turn_conflict');
    expect(ipcErrorMessage(wrap('workspace_chat_revision_conflict'))).toContain('workspace_chat_revision_conflict');
    expect(ipcErrorCode(wrap('app_shutting_down'))).toBe('app_shutting_down');
  });
});
