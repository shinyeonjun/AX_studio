import type { ExecutionLogEntry } from '../modules/types.js';

const PHASE_LABELS: Record<string, string> = {
  pair_analysis: '양식·예시 분석', rdb_schema: 'DB 구조 확인', source_plan: '조회 방법 구성',
  http_probe: 'API 구조 확인', source_refinement: '조회 방법 검증', example_capture: '예시 기간 데이터 조회',
  business_plan: '계산 기준·배치 구성', example_replay: '예시 재현 검증',
  target_capture: '대상 기간 데이터 조회', target_calculation: '보고서 계산',
  pdf_render: 'PDF 작성', artifact_store: '결과 파일 저장',
  'report-business-plan': '계산 기준 구성', 'report-layout-plan': '양식 배치 구성',
  'report-business-plan-revision': '계산 기준 수정', 'report-layout-plan-revision': '양식 배치 수정',
  'report-source-plan': '조회 방법 구성', 'report-source-refinement': '조회 방법 검증',
};

export function reportFailureMessage(log: ExecutionLogEntry[], code: string): string[] {
  const entry = [...log].reverse().find((item) => item.level === 'error' && item.data
    && typeof item.data === 'object' && 'phase' in item.data);
  if (!entry || !entry.data || typeof entry.data !== 'object' || !('phase' in entry.data)) return [];
  const phase = typeof entry.data.phase === 'string' ? PHASE_LABELS[entry.data.phase] : undefined;
  const lines = phase ? [`중단된 단계: ${phase}`] : [];
  if (code === 'agent_timeout') lines.push('AI 처리 시간이 초과되었습니다.');
  else if (code === 'agent_aborted') lines.push('AI 요청이 취소되었습니다.');
  else if (code === 'model_output_invalid') lines.push('AI 응답이 필요한 형식을 충족하지 못했습니다.');
  else if (code === 'report_example_replay_failed') lines.push('예시 보고서의 값을 재현하지 못했습니다. 계산 기준과 과거 시점 데이터를 확인해 주세요.');
  else if (code === 'report_table_capacity_exceeded') lines.push('결과 행이 양식의 표 용량을 초과했습니다. 행을 잘라내지 않았습니다. 더 큰 양식이나 명시적인 집계 기준이 필요합니다.');
  else if (code === 'report_checkpoint_input_changed') lines.push('자료·연결·요청이 변경되어 이전 결과를 재사용할 수 없습니다. 새 실행으로 요청해 주세요.');
  else if (code === 'report_checkpoint_not_found') lines.push('이 실행에는 저장된 중간 결과가 없습니다. 새 보고서 생성으로 요청해 주세요.');
  else if (code === 'report_checkpoint_not_failed') lines.push('실패가 기록된 실행만 이어서 재시도할 수 있습니다. 진행 중이거나 완료된 실행의 상태를 확인해 주세요.');
  else if (code === 'report_join_row_limit') lines.push('데이터 연결 결과가 너무 많습니다. 중복 키와 연결 기준을 확인해 주세요.');
  else if (code === 'report_capture_row_limit' || code === 'report_capture_byte_limit' || code === 'report_planning_context_too_large') lines.push('처리할 데이터가 현재 작업 용량을 초과했습니다. 조회 범위나 필요한 필드를 확인해 주세요.');
  if ('resumeAvailable' in entry.data && entry.data.resumeAvailable === true) {
    lines.push('중간 결과가 저장되어 있습니다. 이 실행 ID를 지정해 이어서 재시도할 수 있습니다.');
  }
  return lines;
}
