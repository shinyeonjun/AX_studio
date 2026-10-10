import { describe, expect, it } from 'vitest';
import { formatExecutionResultMessage } from './format.js';

function resultWithPreview(outputPreview: Record<string, unknown>) {
  return {
    executionId: 'exec-1',
    status: 'success' as const,
    log: [{ at: '2026-10-06T00:00:00.000Z', level: 'info' as const, code: 'ai_decision_completed', message: 'done', data: { outputPreview } }],
  };
}

describe('formatExecutionResultMessage', () => {
  it('shows AI confidence as a level and hides internal flags', () => {
    const message = formatExecutionResultMessage(resultWithPreview({ conclusion: '주문 2건', confidence: 1, needMore: false }));
    expect(message).toContain('결론: 주문 2건');
    expect(message).toContain('AI가 얼마나 확실한지: 높음');
    expect(message).not.toContain('신뢰도: 1');
    expect(message).not.toContain('false');
  });

  it('explains when more evidence is needed', () => {
    const message = formatExecutionResultMessage(resultWithPreview({ confidence: 0.3, needMore: true }));
    expect(message).toContain('AI가 얼마나 확실한지: 낮음');
    expect(message).toContain('더 많은 자료를 확인해야');
  });

  it('names the spreadsheet by file name and row count without its storage id', () => {
    const message = formatExecutionResultMessage({
      executionId: 'exec-1',
      status: 'success',
      log: [{ at: '2026-10-06T00:00:00.000Z', level: 'info', code: 'xlsx_generated', message: 'saved',
        data: { artifactId: 'art_abc123', fileName: 'table.xlsx', rowCount: 1200 } }],
    });
    expect(message).toContain('엑셀 파일: table.xlsx (1,200행)');
    expect(message).not.toContain('art_abc123');
  });

  it('says how much of the example a written report reproduced, only when it succeeded', () => {
    const log = [{ at: '2026-10-06T00:00:00.000Z', level: 'info' as const, code: 'report_example_replay_passed',
      message: 'ok', data: { verifiedSlots: 18 } }];
    expect(formatExecutionResultMessage({ executionId: 'exec-1', status: 'success', log }))
      .toContain('지난 보고서의 값 18개를 같은 방법으로 다시 만들어 일치하는지 확인했어요.');
    expect(formatExecutionResultMessage({ executionId: 'exec-1', status: 'failed', log })).not.toContain('검증:');
  });

  it('says why a run failed in words and keeps the run number for resuming', () => {
    const message = formatExecutionResultMessage({
      executionId: 'exec-9',
      status: 'failed',
      errorCode: 'workflow_paused',
      log: [],
    });
    expect(message).toContain('원인: 업무가 꺼져 있습니다');
    expect(message).toContain('실행 번호: exec-9');
    expect(message).not.toContain('workflow_paused');
  });

  it('drops a failure code it has no words for', () => {
    const message = formatExecutionResultMessage({ executionId: 'exec-2', status: 'failed', errorCode: 'weird_internal_code', log: [] });
    expect(message).not.toContain('weird_internal_code');
    expect(message).not.toContain('오류 코드');
  });
});

describe('why a run failed, in the chat', () => {
  const failed = (errorCode: string, log: Array<{ level: 'error' | 'info'; message: string }> = []) => ({
    executionId: 'exec-f', status: 'failed' as const, errorCode,
    log: log.map((entry) => ({ at: '2026-10-08T00:00:00.000Z', code: 'step', ...entry })),
  });

  it('says the specific reason when the code has one', () => {
    expect(formatExecutionResultMessage(failed('jev_busy'), { workflowName: '메일 요약' })).toContain('원인: 판단 엔진(Jev) 서버가 잠시 응답하지 않았습니다');
    expect(formatExecutionResultMessage(failed('not_in_channel'), {})).toContain('채널에 앱을 추가해 주세요');
  });

  it('uses the step\'s own words when the code is broad, and never leaves the reason out', () => {
    const message = formatExecutionResultMessage(failed('http_error', [{ level: 'error', message: '서버가 접근을 거부했어요. 연결의 로그인 정보를 확인해 주세요.' }]), {});
    expect(message).toContain('원인: 서버가 접근을 거부했어요. 연결의 로그인 정보를 확인해 주세요');
    expect(message).not.toContain('연결된 서비스에서 자료를 가져오지 못했습니다');
    expect(formatExecutionResultMessage(failed('ENOENT'), {})).toContain('원인: 실행 중 문제가 생겼습니다. 활동 화면에서');
  });
});
