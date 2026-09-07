import { expect, it } from 'vitest';
import { formatExecutionResultMessage } from '../../runtime/execution-result/format.js';

it('distinguishes missing source evidence from provider failure without promising automatic resume', () => {
  const text = formatExecutionResultMessage({ executionId: 'execution', status: 'failed', errorCode: 'report_source_discovery_needs_input',
    log: [{ at: '2038-01-01', level: 'error', message: 'private data', data: { phase: 'source_plan', resumeAvailable: true } }],
  });
  expect(text).toContain('API 명세');
  expect(text).not.toContain('이 실행 ID를 지정해');
  expect(text).not.toContain('private data');
});

it('explains exhausted source replanning without encouraging identical cached retries', () => {
  const text = formatExecutionResultMessage({ executionId: 'execution', status: 'failed', errorCode: 'report_source_replan_limit',
    log: [{ at: '2038-01-01', level: 'error', message: 'private source data',
      data: { phase: 'source_plan-sources-2', resumeAvailable: true } }],
  });
  expect(text).toContain('조회 방법 구성');
  expect(text).toContain('새 요청');
  expect(text).not.toContain('이 실행 ID를 지정해');
  expect(text).not.toContain('private source data');
});

it('explains repeated source inspection as a new-route decision', () => {
  const text = formatExecutionResultMessage({ executionId: 'execution', status: 'failed', errorCode: 'report_source_discovery_no_progress',
    log: [{ at: '2032-01-01', level: 'error', code: 'report_source_discovery_no_progress', message: 'private detail',
      data: { phase: 'source_plan', resumeAvailable: true } }],
  });
  expect(text).toContain('다른 연결·경로');
  expect(text).not.toContain('private detail');
});

it('explains HTTP 404 without encouraging replay of a wrong connection selection', () => {
  const text = formatExecutionResultMessage({ executionId: 'execution', status: 'failed', errorCode: 'report_http_probe_status',
    log: [
      { at: '2032-01-01', level: 'error', message: 'http.request_failed', data: { status: 404, body: 'private-response' } },
      { at: '2032-01-01', level: 'error', code: 'report_http_probe_status', message: 'report_http_probe_status:orders:404', data: { phase: 'http_probe', resumeAvailable: true } },
    ],
  });
  expect(text).toContain('HTTP 404');
  expect(text).toContain('새 요청');
  expect(text).not.toContain('이 실행 ID를 지정해');
  expect(text).not.toContain('private-response');
});

it('explains evidence exhaustion without implying a PDF was generated', () => {
  const text = formatExecutionResultMessage({ executionId: 'execution', status: 'failed', errorCode: 'report_evidence_round_limit',
    log: [{ at: '2032-01-01', level: 'error', code: 'report_evidence_round_limit', message: 'private payload',
      data: { phase: 'business_plan' } }],
  });
  expect(text).toContain('계산 계획을 확정하지 못했습니다');
  expect(text).toContain('결과를 임의로 생성하지 않았습니다');
  expect(text).not.toContain('private payload');
});

it('projects the actual planning phase and safe recovery instructions into the result', () => {
  const text = formatExecutionResultMessage({ executionId: 'execution', status: 'failed', errorCode: 'agent_timeout',
    log: [{ at: '2032-01-01', level: 'error', code: 'agent_timeout', message: 'private provider detail',
      data: { phase: 'report-layout-plan', resumeAvailable: true } }],
  });
  expect(text).toContain('양식 배치 구성');
  expect(text).toContain('AI 처리 시간이 초과');
  expect(text).not.toContain('private provider detail');
});

it.each(['report_http_pagination_no_progress', 'report_rdb_pagination_no_progress'])
  ('explains incomplete source pagination for %s', (errorCode) => {
    const text = formatExecutionResultMessage({ executionId: 'execution', status: 'failed', errorCode,
      log: [{ at: '2032-01-01', level: 'error', code: errorCode, message: 'private source detail',
        data: { phase: 'example_capture' } }],
    });
    expect(text).toContain('원천 데이터 페이지');
    expect(text).toContain('불완전한 데이터로 보고서를 생성하지 않았습니다');
    expect(text).not.toContain('private source detail');
  });
