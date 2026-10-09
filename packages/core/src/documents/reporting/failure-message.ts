import type { ExecutionLogEntry } from '../../connectors/types.js';

const PHASE_LABELS: Record<string, string> = {
  template_derivation: '완성 보고서에서 빈 양식 만들기', 'report-example-values': '기간마다 바뀌는 값 찾기',
  pair_analysis: '양식·예시 분석', rdb_schema: 'DB 구조 확인', source_plan: '조회 방법 구성',
  source_requirements: '필요한 원본 데이터 확인', 'report-source-requirements': '필요한 원본 데이터 확인',
  http_probe: '연결된 서비스 확인', source_refinement: '조회 방법 검증', example_capture: '예시 기간 데이터 조회',
  business_plan: '계산 기준·배치 구성', example_replay: '예시와 같은 결과가 나오는지 확인',
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
  const phase = phaseKey?.startsWith('source-inspection-') ? '연결된 원본 데이터 확인' : phaseKey ? PHASE_LABELS[phaseKey] : undefined;
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
  if (httpNeedsNewPlan) lines.push('고른 서비스에서 필요한 자료를 찾지 못했습니다. 연결과 서버 주소가 맞는지 확인한 뒤, 어떤 연결을 쓸지 알려 주시고 새 요청으로 실행해 주세요.');
  else if (httpProbeFailure && (httpStatus === 401 || httpStatus === 403)) lines.push('연결된 서비스가 접근을 거부했습니다. 설정에서 연결의 로그인 정보를 확인해 주세요.');
  else if (httpProbeFailure) lines.push('연결된 서비스에서 자료를 확인하지 못했습니다. 설정에서 연결과 서버 주소를 확인해 주세요.');
  if (code === 'agent_timeout') lines.push('AI 처리 시간이 초과되었습니다.');
  else if (code === 'report_source_discovery_no_progress') lines.push('같은 연결을 여러 번 확인해도 필요한 자료를 찾지 못했습니다. 다른 연결·경로를 알려 주시거나 서비스 설명 문서를 추가한 뒤 새 요청으로 실행해 주세요.');
  else if (code === 'report_source_discovery_needs_input') lines.push('어디서 숫자를 가져올지 정하지 못해 보고서를 만들지 않았습니다. 쓸 자료를 함께 적어 다시 요청해 주세요. 예: 어느 폴더의 어떤 파일, 어느 데이터베이스 표, 어느 API.');
  else if (code === 'report_source_discovery_unsupported') lines.push('필요한 자료를 가져오는 방법을 아직 지원하지 않습니다. 결과를 임의로 만들지 않았습니다.');
  else if (code === 'report_capture_refinement_jev_unavailable' || code === 'report_capture_refinement_jev_failed') {
    lines.push('판단 엔진(Jev)이 가져올 자료를 고르지 못했습니다. 설정 > 판단 엔진에서 연결 상태를 확인한 뒤 다시 시도해 주세요. 확실하지 않은 짐작으로 대신 실행하지 않았습니다.');
  }
  else if (code === 'report_capture_refinement_jev_answer_invalid') {
    lines.push('판단 엔진(Jev)이 가져올 자료를 하나로 정하지 못했습니다. 잘못된 자료로 보고서를 만들지 않았습니다.');
  }
  else if (sourceNeedsNewPlan) lines.push('필요한 원본 데이터를 모두 가져올 방법을 정하지 못했습니다. 연결된 서비스에 필요한 자료가 있는지 확인한 뒤 새 요청으로 실행해 주세요. 불완전한 데이터로 보고서를 생성하지 않았습니다.');
  else if (code === 'report_evidence_deadline_exceeded') lines.push('계산 근거를 확인하는 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.');
  else if (['report_evidence_no_progress', 'report_evidence_round_limit', 'report_evidence_insufficient_evidence', 'report_evidence_ambiguous_rule', 'report_evidence_unsupported_operation'].includes(code)) lines.push('추가 근거를 확인했지만 계산 계획을 확정하지 못했습니다. 계산 기준과 자료를 확인해 주세요. 결과를 임의로 생성하지 않았습니다.');
  else if (code.startsWith('report_evidence_')) lines.push('요청된 계산 근거가 허용된 자료·범위 또는 처리 용량을 벗어났습니다. 결과를 임의로 생성하지 않았습니다.');
  else if (code === 'agent_aborted') lines.push('AI 요청이 취소되었습니다.');
  else if (code === 'model_output_invalid') lines.push('AI 응답이 필요한 형식을 충족하지 못했습니다.');
  else if (code === 'report_example_period_in_form') lines.push('지난 보고서의 날짜가 기간마다 바뀌는 값으로 잡히지 않아, 그대로 두면 이번 보고서에 지난 날짜가 남습니다. 틀린 보고서를 만들지 않으려고 멈췄습니다. 다시 시도해 주세요.');
  else if (code === 'report_example_replay_failed') lines.push('예시 보고서와 같은 값이 나오지 않았습니다. 계산 기준과 예시 기간의 데이터를 확인해 주세요.');
  else if (['report_http_response_incomplete', 'report_http_pagination_no_progress',
    'report_rdb_response_incomplete', 'report_rdb_pagination_no_progress', 'report_rdb_page_limit'].includes(code)) {
    lines.push('원본 데이터를 끝까지 읽지 못했습니다. 연결된 서비스나 데이터베이스의 자료가 도중에 바뀌지 않았는지 확인한 뒤 다시 요청해 주세요. 불완전한 데이터로 보고서를 생성하지 않았습니다.');
  }
  else if (code === 'report_table_capacity_exceeded') lines.push('결과 행이 양식의 표 용량을 초과했습니다. 행을 잘라내지 않았습니다. 더 큰 양식이나 명시적인 집계 기준이 필요합니다.');
  else if (code === 'report_file_period_missing') {
    const failed = [...log].reverse().find((item) => item.level === 'error' && item.message.startsWith('report_file_period_missing:'));
    const fileName = failed?.message.split(':').slice(2).join(':').trim();
    lines.push(`${fileName ? `이번 기간 파일(${fileName.slice(0, 200)})` : '이번 기간 파일'}이 연결된 폴더에 없어 보고서를 만들지 않았습니다. 파일을 폴더에 넣은 뒤 다시 요청해 주세요.`);
  }
  else if (code === 'report_file_period_name_unknown') lines.push('파일 이름에 기간(예: 2026-09)이 없어 이번 기간 파일을 고를 수 없습니다. 기간이 들어간 이름으로 저장하거나, 모든 기간이 한 파일에 있는지 알려 주세요.');
  else if (code === 'report_file_unknown' || code === 'report_file_reader_unavailable') lines.push('고른 파일을 연결된 폴더에서 찾을 수 없습니다. 설정에서 폴더 연결을 확인해 주세요.');
  else if (code === 'report_file_response_incomplete' || code === 'report_file_response_invalid' || code === 'report_file_request_failed') {
    lines.push('파일을 끝까지 읽지 못했습니다. 파일이 다른 프로그램에서 열려 있거나 손상되지 않았는지 확인해 주세요. 불완전한 데이터로 보고서를 생성하지 않았습니다.');
  }
  else if (code === 'report_template_source_required') lines.push('완성 보고서만으로 빈 양식을 만들 수 없는 환경입니다. 빈 양식 PDF를 함께 올려 주세요.');
  else if (code === 'report_example_has_no_text') lines.push('올린 보고서에서 글자를 읽을 수 없습니다. 스캔한 이미지 PDF는 아직 지원하지 않습니다. 글자를 고를 수 있는 PDF로 올려 주세요.');
  else if (code === 'report_example_too_much_text') lines.push('보고서의 글이 너무 많아 처리하지 못했습니다. 페이지를 나눠 올려 주세요.');
  else if (code === 'report_example_values_not_found') lines.push('올린 보고서에서 기간마다 바뀌는 값을 찾지 못했습니다. 값이 채워진 보고서인지 확인해 주시거나, 빈 양식 PDF를 함께 올려 주세요.');
  else if (code.startsWith('report_value_not_removed')) lines.push('보고서에서 지난 기간 값을 지우지 못해 빈 양식을 만들지 못했습니다. 빈 양식 PDF를 함께 올려 주시면 그 양식으로 작성합니다.');
  else if (code === 'report_checkpoint_input_changed') lines.push('자료·연결·요청이 변경되어 이전 결과를 재사용할 수 없습니다. 새 실행으로 요청해 주세요.');
  else if (code === 'report_checkpoint_not_found') lines.push('이 실행에는 저장된 중간 결과가 없습니다. 새 보고서 생성으로 요청해 주세요.');
  else if (code === 'report_checkpoint_not_failed') lines.push('실패한 실행만 이어서 다시 할 수 있습니다. 진행 중이거나 완료된 실행인지 확인해 주세요.');
  else if (code === 'report_join_row_limit') lines.push('데이터 연결 결과가 너무 많습니다. 중복 키와 연결 기준을 확인해 주세요.');
  else if (code === 'report_capture_row_limit' || code === 'report_capture_byte_limit' || code === 'report_planning_context_too_large') lines.push('처리할 데이터가 너무 많습니다. 기간을 줄이거나 필요한 열만 골라 주세요.');
  if (!needsNewPlan && 'resumeAvailable' in entry.data && entry.data.resumeAvailable === true) {
    lines.push("중간 결과가 저장되어 있어 '이어서 다시 해줘'라고 하면 계속할 수 있어요.");
  }
  return lines;
}
