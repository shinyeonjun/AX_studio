import type { ExecutionLogEntry } from '../../connectors/types.js';

const PHASE_LABELS: Record<string, string> = {
  pair_analysis: '양식·예시 분석', rdb_schema: 'DB 구조 확인', source_plan: '조회 방법 구성',
  source_requirements: '필수 원천 확인', 'report-source-requirements': '필수 원천 확인',
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
  const phaseKey = typeof entry.data.phase === 'string'
    ? entry.data.phase.replace(/-sources-\d+$/, '').replace(/-inspect-\d+$/, '') : undefined;
  const phase = phaseKey?.startsWith('source-inspection-') ? '연결된 원천 구조 확인' : phaseKey ? PHASE_LABELS[phaseKey] : undefined;
  const lines = phase ? [`중단된 단계: ${phase}`] : [];
  if (code === 'report_source_discovery_needs_input' && 'clarification' in entry.data
      && typeof entry.data.clarification === 'string' && entry.data.clarification.trim()) {
    lines.push(`확인이 필요한 내용: ${entry.data.clarification.slice(0, 1000)}`);
  }
  const httpProbeFailure = code === 'report_http_probe_status' || code === 'report_http_probe_failed';
  const httpEntry = httpProbeFailure ? [...log].reverse().find(item =>
    item.message === 'http.request_failed' && item.data && typeof item.data === 'object' && 'status' in item.data) : undefined;
  const httpStatus = httpEntry?.data && typeof httpEntry.data === 'object' && 'status' in httpEntry.data
    && typeof httpEntry.data.status === 'number' ? httpEntry.data.status : undefined;
  const httpNeedsNewPlan = httpProbeFailure && httpStatus === 404;
  const sourceNeedsNewPlan = code.startsWith('report_source_replan_') || code.startsWith('report_source_discovery_') || code === 'report_source_binding_unknown';
  const needsNewPlan = httpNeedsNewPlan || sourceNeedsNewPlan;
  if (httpNeedsNewPlan) lines.push('선택된 API 서버에 해당 경로가 없습니다(HTTP 404). 주문 API가 맞는지 연결·주소를 확인해 주세요. 잘못 선택된 조회 계획을 반복하지 않도록 연결을 명시해 새 요청으로 실행해 주세요.');
  else if (httpProbeFailure && (httpStatus === 401 || httpStatus === 403)) lines.push('선택된 API의 인증 또는 조회 권한이 거부되었습니다. 연결 설정을 확인해 주세요.');
  else if (httpProbeFailure) lines.push('선택된 API의 구조를 확인하지 못했습니다. 연결 서버·조회 경로와 실행 기록을 확인해 주세요.');
  if (code === 'agent_timeout') lines.push('AI 처리 시간이 초과되었습니다.');
  else if (code === 'report_source_discovery_no_progress') lines.push('같은 연결과 경로를 반복 확인해도 진행되지 않았습니다. 실패한 연결을 반복하지 말고 다른 연결·경로를 지정하거나 API 명세를 추가해 새 요청으로 실행해 주세요.');
  else if (code === 'report_source_discovery_needs_input') lines.push('연결된 자료만으로 조회 방법을 확정할 수 없습니다. 필요한 API 명세·조회 경로나 DB 구조 정보를 확인해 주세요. 조회 계획이 확정되지 않아 보고서를 생성하지 않았습니다.');
  else if (code === 'report_source_discovery_unsupported') lines.push('필요한 조회 방식이 현재 지원되는 기능에 포함되지 않습니다. 결과를 임의로 생성하지 않았습니다.');
  else if (sourceNeedsNewPlan) lines.push('필요한 원천 데이터를 모두 포함하는 조회 계획을 확정하지 못했습니다. 허용된 연결과 필요한 데이터의 제공 여부를 확인한 뒤 새 요청으로 실행해 주세요. 불완전한 데이터로 보고서를 생성하지 않았습니다.');
  else if (code === 'report_evidence_deadline_exceeded') lines.push('계산 근거를 확인하는 전체 시간이 초과되었습니다. 저장된 실행 기록에서 이어서 재시도할 수 있는지 확인해 주세요.');
  else if (['report_evidence_no_progress', 'report_evidence_round_limit', 'report_evidence_insufficient_evidence', 'report_evidence_ambiguous_rule', 'report_evidence_unsupported_operation'].includes(code)) lines.push('추가 근거를 확인했지만 계산 계획을 확정하지 못했습니다. 계산 기준·자료 또는 지원 연산의 확인이 필요합니다. 결과를 임의로 생성하지 않았습니다.');
  else if (code.startsWith('report_evidence_')) lines.push('요청된 계산 근거가 허용된 자료·범위 또는 처리 용량을 벗어났습니다. 결과를 임의로 생성하지 않았습니다.');
  else if (code === 'agent_aborted') lines.push('AI 요청이 취소되었습니다.');
  else if (code === 'model_output_invalid') lines.push('AI 응답이 필요한 형식을 충족하지 못했습니다.');
  else if (code === 'report_example_replay_failed') lines.push('예시 보고서의 값을 재현하지 못했습니다. 계산 기준과 과거 시점 데이터를 확인해 주세요.');
  else if (code === 'report_table_capacity_exceeded') lines.push('결과 행이 양식의 표 용량을 초과했습니다. 행을 잘라내지 않았습니다. 더 큰 양식이나 명시적인 집계 기준이 필요합니다.');
  else if (code === 'report_checkpoint_input_changed') lines.push('자료·연결·요청이 변경되어 이전 결과를 재사용할 수 없습니다. 새 실행으로 요청해 주세요.');
  else if (code === 'report_checkpoint_not_found') lines.push('이 실행에는 저장된 중간 결과가 없습니다. 새 보고서 생성으로 요청해 주세요.');
  else if (code === 'report_checkpoint_not_failed') lines.push('실패가 기록된 실행만 이어서 재시도할 수 있습니다. 진행 중이거나 완료된 실행의 상태를 확인해 주세요.');
  else if (code === 'report_join_row_limit') lines.push('데이터 연결 결과가 너무 많습니다. 중복 키와 연결 기준을 확인해 주세요.');
  else if (code === 'report_capture_row_limit' || code === 'report_capture_byte_limit' || code === 'report_planning_context_too_large') lines.push('처리할 데이터가 현재 작업 용량을 초과했습니다. 조회 범위나 필요한 필드를 확인해 주세요.');
  if (!needsNewPlan && 'resumeAvailable' in entry.data && entry.data.resumeAvailable === true) {
    lines.push('중간 결과가 저장되어 있습니다. 이 실행 ID를 지정해 이어서 재시도할 수 있습니다.');
  }
  return lines;
}
