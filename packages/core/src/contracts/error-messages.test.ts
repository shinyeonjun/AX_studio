import { describe, expect, it } from 'vitest';
import { aiProviderErrorMessage, connectorErrorMessage, executionErrorReason } from './error-messages.js';

describe('connectorErrorMessage', () => {
  it.each([
    ['rdb_query_failed', '데이터베이스에서 자료를 가져오지 못했어요'],
    ['to_required', '받는 사람이 비어 있어요'],
    ['channel_required', 'Slack 채널'],
    ['http_connection_not_found', '서비스 연결을 찾지 못했어요'],
    ['Unknown gmail action: messages.fly', '지원하지 않는 작업'],
    ['template required', '서식 파일이 필요해요'],
    ['http_404', '찾지 못했어요'],
    ['http_503', '잠시 후 다시 시도해 주세요'],
  ])('puts %s into words', (error, expected) => {
    const message = connectorErrorMessage(error);
    expect(message).toContain(expected);
    expect(message).not.toContain(error);
  });

  it('never shows an unmapped machine code but keeps readable messages', () => {
    expect(connectorErrorMessage('some_new_failure')).not.toContain('some_new_failure');
    expect(connectorErrorMessage(undefined)).toMatch(/[가-힣]/u);
    expect(connectorErrorMessage('PDF 저장소가 준비되지 않았습니다.')).toBe('PDF 저장소가 준비되지 않았습니다.');
  });
});

describe('executionErrorReason', () => {
  it('words known codes and leaves unknown ones out', () => {
    expect(executionErrorReason('workflow_paused')).toBe('업무가 꺼져 있습니다');
    expect(executionErrorReason('not_a_code')).toBeUndefined();
    expect(executionErrorReason('toString')).toBeUndefined();
  });
});

describe('aiProviderErrorMessage', () => {
  const coded = (message: string, fields: Record<string, unknown>) => Object.assign(new Error(message), fields);

  it.each([
    ['harness timeout', coded('Agent timed out after 180000ms', { code: 'agent_timeout' }), '너무 오래 걸려'],
    ['chat deadline', new Error('ax_command_chat_timeout'), '너무 오래 걸려'],
    ['decision engine timeout', new Error('TypeSafe request timed out.'), '너무 오래 걸려'],
    ['API 401 with a Korean fallback text', coded('Anthropic API 호출 실패 (401)', { status: 401 }), '설정 > AI에서 확인'],
    ['API 401 with a JSON body', coded('{"type":"error","error":{"type":"authentication_error"}}', { status: 401 }), '설정 > AI에서 확인'],
    ['CLI invalid key', new Error('Invalid API key · Please run /login'), '설정 > AI에서 확인'],
    ['Codex unauthorized', new Error('unexpected status 401 Unauthorized: Incorrect API key provided'), '설정 > AI에서 확인'],
    ['API 429', coded('rate limited', { status: 429 }), '잠시 바쁩니다'],
    ['API 529', coded('{"type":"error","error":{"type":"overloaded_error"}}', { status: 529 }), '잠시 바쁩니다'],
    ['CLI overloaded', new Error('API Error: 529 {"type":"overloaded_error","message":"Overloaded"}'), '잠시 바쁩니다'],
    ['CLI rate limit', new Error('exceeded retry limit, last status: 429 Too Many Requests'), '잠시 바쁩니다'],
    ['CLI missing', coded('spawn claude ENOENT', { code: 'ENOENT', syscall: 'spawn claude' }), 'AI 프로그램을 찾지 못했습니다'],
    ['Windows shell missing CLI', new Error("'codex' is not recognized as an internal or external command"), 'AI 프로그램을 찾지 못했습니다'],
    ['wrapped provider error', new Error('decision failed', { cause: coded('Too Many Requests', { status: 429 }) }), '잠시 바쁩니다'],
  ])('puts a %s into words', (_name, error, expected) => {
    expect(aiProviderErrorMessage(error)).toContain(expected);
  });

  it('leaves Korean messages and unrelated failures alone', () => {
    expect(aiProviderErrorMessage(new Error('Claude CLI이(가) 설치되어 있지 않습니다.'))).toBeUndefined();
    expect(aiProviderErrorMessage(new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다. 설정에서 API 키를 등록하세요.'))).toBeUndefined();
    expect(aiProviderErrorMessage(new Error('workspace_chat_revision_conflict'))).toBeUndefined();
    expect(aiProviderErrorMessage(coded("ENOENT: no such file or directory, open 'C:\data\a.xlsx'", { code: 'ENOENT', syscall: 'open' }))).toBeUndefined();
    expect(aiProviderErrorMessage(coded('Agent request aborted', { code: 'agent_aborted' }))).toBeUndefined();
    expect(aiProviderErrorMessage(new Error('http_401'))).toBeUndefined();
    expect(aiProviderErrorMessage(undefined)).toBeUndefined();
  });
});
