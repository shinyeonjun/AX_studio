import { describe, expect, it } from 'vitest';
import { connectorErrorMessage, executionErrorReason } from './error-messages.js';

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
