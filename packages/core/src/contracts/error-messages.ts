/**
 * Plain Korean wording for failure codes and raw connector errors.
 *
 * Codes stay machine-readable everywhere else (logs, tests, recovery logic);
 * this is the one place that turns them into sentences a user can act on.
 * Pure and browser-safe: the desktop renderer imports it directly.
 */

const EXECUTION_ERROR_REASONS: Record<string, string> = {
  execution_failed: '실행 중 오류가 발생했습니다',
  pending_approval: '승인을 기다리는 중입니다',
  approval_rejected: '승인이 거절되었습니다',
  global_off_duty: '전체 퇴근 상태라 실행하지 않았습니다',
  action_failed: '작업을 완료하지 못했습니다',
  path_required: '문서 경로가 비어 있습니다',
  manual_run_input_missing: '실행할 파일을 찾지 못했습니다',
  document_ingest_failed: '문서 읽기에 실패했습니다',
  document_engine_empty_response: 'Document Engine 응답이 없습니다. Python venv 설치 후 앱을 재시작해 주세요.',
  document_engine_dependency_missing: '문서 엔진 Python 패키지가 없습니다. `AX_DOCUMENT_ENGINE_PYTHON`을 설정했다면 지우고 앱을 다시 시작하세요. 계속 실패하면 프로젝트 루트에서 `npm run document-engine:setup`을 실행한 뒤 다시 시작해 주세요.',
  slack_error: 'Slack 작업에 실패했습니다',
  not_in_channel: 'Slack 앱이 채널에 들어가 있지 않습니다. 채널에 앱을 추가해 주세요',
  invalid_auth: 'Slack 연결 정보가 올바르지 않습니다. 설정에서 Slack을 다시 연결해 주세요',
  token_revoked: 'Slack 연결이 취소되었습니다. 설정에서 Slack을 다시 연결해 주세요',
  missing_scope: 'Slack 앱에 필요한 권한이 없습니다. 연결 안내의 권한을 추가해 주세요',
  ratelimited: 'Slack 요청이 잠시 너무 많았습니다. 잠시 후 다시 시도해 주세요',
  gmail_scope_missing: 'Gmail 권한이 부족합니다. 설정에서 Gmail을 다시 연결해 주세요',
  gmail_rate_limited: 'Gmail 요청이 잠시 너무 많았습니다. 잠시 후 다시 시도해 주세요',
  gmail_unavailable: 'Gmail이 잠시 응답하지 않았습니다. 잠시 후 다시 시도해 주세요',
  jev_busy: '판단 엔진(Jev) 서버가 잠시 응답하지 않았습니다. 설정은 그대로 두고 잠시 후 다시 실행해 주세요',
  jev_unreachable: '판단 엔진(Jev) 서버에 닿지 못했습니다. 인터넷 연결을 확인해 주세요',
  jev_key_rejected: '판단 엔진(Jev)이 API 키를 거부했습니다. 설정 > 판단 엔진에서 키를 확인해 주세요',
  jev_decision_failed: '판단 엔진(Jev)이 판단하지 못해 실행을 멈췄습니다. 잠시 후 다시 실행해 주세요',
  ai_auth_failed: 'AI 연결 정보가 올바르지 않습니다. 설정 > AI에서 확인해 주세요',
  ai_busy: 'AI 서비스가 잠시 바빴습니다. 잠시 후 다시 실행해 주세요',
  ai_cli_missing: 'AI 프로그램을 찾지 못했습니다. 설정 > AI에서 연결 상태를 확인해 주세요',
  ai_unreachable: 'AI에 연결하지 못했습니다. AI 프로그램이 켜져 있는지 확인해 주세요',
  folder_not_accessible: '연결된 폴더를 열 수 없습니다. 폴더가 옮겨졌거나 네트워크 드라이브가 끊겼는지 확인해 주세요',
  folder_scan_timeout: '폴더를 확인하는 데 시간이 너무 걸렸습니다. 잠시 후 다시 시도해 주세요',
  rdb_connection_not_found: '이 업무가 쓰던 데이터베이스 연결을 찾지 못했습니다. 설정에서 데이터베이스를 다시 연결해 주세요',
  rdb_connection_required: '어느 데이터베이스에서 읽을지 정해지지 않았습니다. 데이터베이스를 골라 주세요',
  connection_failed: '서버에 연결하지 못했습니다. 인터넷 연결과 서버 주소를 확인해 주세요',
  request_timeout: '서버가 제때 응답하지 않았습니다. 잠시 후 다시 시도해 주세요',
  gmail_error: 'Gmail 작업에 실패했습니다',
  agent_invoke_failed: 'AI 판단 단계를 실행하지 못했습니다',
  agent_timeout: 'AI 판단 단계가 시간 초과되었습니다',
  workflow_paused: '업무가 꺼져 있습니다',
  output_contract_failed: '결과 품질 검증에서 차단되었습니다',
  input_schema_drift: '입력 자료의 열 구성이 바뀌었습니다',
  workflow_already_running: '같은 업무가 이미 실행 중이라 이번 실행은 건너뛰었습니다',
  workflow_run_queue_full: '대기 중인 실행이 너무 많아 이번 실행은 건너뛰었습니다',
  approval_expired: '승인 대기 시간이 지나 실행이 취소되었습니다. 아무 작업도 실행되지 않았습니다',
  template_non_primitive: '단계 입력에 목록·객체 값이 들어가 문장으로 바꿀 수 없습니다. 업무 단계의 입력값을 확인해 주세요',
  condition_ref_missing: '조건 분기가 확인할 이전 단계 결과를 찾지 못했습니다',
  step_timeout: '단계 실행 시간이 초과되었습니다. 외부 서비스에 이미 반영됐을 수 있으니 결과를 확인해 주세요',
  oauth_refresh_failed: 'Google 로그인이 만료되었습니다. 설정에서 Gmail을 다시 연결해 주세요',
  file_not_found: '필요한 파일을 찾지 못했습니다. 경로를 확인해 주세요',
  connector_missing: '필요한 연결이 없습니다. 설정에서 연결을 확인해 주세요',
  cancelled: '실행이 취소되었습니다',
  aborted: '실행이 취소되었습니다',
  timeout: '응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요',
  ssrf_blocked: '안전하지 않은 주소라 요청하지 않았습니다',
  policy_denied: '허용되지 않은 작업이라 실행하지 않았습니다',
  invalid_params: '단계에 필요한 값이 비어 있거나 올바르지 않습니다',
  rdb_error: '데이터베이스에서 자료를 가져오지 못했습니다',
  http_error: '연결된 서비스에서 자료를 가져오지 못했습니다',
  http_error_status: '연결된 서비스가 요청을 처리하지 못했습니다',
  local_folder_not_connected: '폴더가 연결되어 있지 않습니다. 설정에서 폴더를 연결해 주세요',
  folder_not_found: '연결된 폴더를 찾지 못했습니다',
  sheet_not_found: '시트를 찾지 못했습니다',
  file_not_accessible: '파일을 열 수 없습니다',
  template_required: '서식 파일이 필요합니다',
  channel_not_found: 'Slack 채널을 찾지 못했습니다',
};

/**
 * The run code for an AI provider failure, so a run's result says what to do: the person's AI
 * rejected its sign-in, was busy, is not installed or not reachable. Undefined otherwise.
 */
export function aiProviderFailureCode(error: unknown): 'ai_auth_failed' | 'ai_busy' | 'ai_cli_missing' | 'ai_unreachable' | 'agent_timeout' | undefined {
  const message = aiProviderErrorMessage(error);
  if (message === AI_AUTH) return 'ai_auth_failed';
  if (message === AI_BUSY) return 'ai_busy';
  if (message === AI_MISSING) return 'ai_cli_missing';
  if (message === AI_UNREACHABLE || message === AI_MODEL_MISSING) return 'ai_unreachable';
  if (message === AI_TIMEOUT) return 'agent_timeout';
  return undefined;
}

/** A plain reason for a known failure code, or undefined when there is none. */
export function executionErrorReason(errorCode?: string | null): string | undefined {
  if (!errorCode) return undefined;
  return Object.hasOwn(EXECUTION_ERROR_REASONS, errorCode) ? EXECUTION_ERROR_REASONS[errorCode] : undefined;
}

const CANCELLED = '실행이 취소되었어요.';
const UNSAFE_ADDRESS = '안전하지 않은 주소라 요청하지 않았어요.';
const BAD_SERVER_ADDRESS = '서버 주소가 올바르지 않아요. 설정에서 서버 주소를 확인해 주세요.';
const DOCUMENT_MISSING = '읽을 문서 정보를 찾지 못했어요.';
const PAGING_FAILED = '자료를 나눠 가져오는 중 문제가 생겼어요. 다시 시도해 주세요.';
const NOT_PERMITTED_METHOD = '이 단계에서는 허용되지 않는 요청 방식이에요.';
const GENERIC = '작업을 완료하지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.';

const CONNECTOR_ERROR_MESSAGES: Record<string, string> = {
  'action failed': GENERIC,
  cancelled: CANCELLED,
  rdb_aborted: CANCELLED,
  request_aborted: CANCELLED,
  folder_scan_aborted: CANCELLED,
  to_required: '받는 사람이 비어 있어요. 받는 사람을 정해 주세요.',
  body_required: '메일 본문이 비어 있어요.',
  channel_required: '보낼 Slack 채널이 정해지지 않았어요. 채널을 골라 주세요.',
  text_required: '보낼 메시지 내용이 비어 있어요.',
  query_required: '검색어가 비어 있어요.',
  invalid_message_payload: '보낼 메시지 형식이 올바르지 않아요.',
  invalid_search_params: '메일을 찾을 조건이 올바르지 않아요.',
  invalid_read_params: '메시지를 가져올 조건이 올바르지 않아요.',
  not_in_channel: 'Slack 앱이 채널에 들어가 있지 않아요. 채널에 앱을 추가해 주세요.',
  channel_not_found: 'Slack 채널을 찾지 못했어요.',
  rdb_query_failed: '데이터베이스에서 자료를 가져오지 못했어요. 연결 상태를 확인해 주세요.',
  rdb_schema_failed: '데이터베이스의 표 구성을 확인하지 못했어요. 연결 상태를 확인해 주세요.',
  rdb_table_metadata_unavailable: '데이터베이스의 표 구성을 확인하지 못했어요. 연결 상태를 확인해 주세요.',
  rdb_read_only_fields_required: '가져올 열을 먼저 정해 주세요.',
  rdb_rows_invalid: '데이터베이스에서 받은 자료 형식이 올바르지 않아요.',
  invalid_table_name: '이 표는 읽도록 허용되어 있지 않아요.',
  table_not_allowed: '이 표는 읽도록 허용되어 있지 않아요.',
  invalid_join: '표를 잇는 기준이 올바르지 않아요.',
  invalid_metadata_pagination: PAGING_FAILED,
  invalid_row_pagination: PAGING_FAILED,
  invalid_folder_pagination: PAGING_FAILED,
  http_connection_required: '연결된 서비스가 없어요. 설정에서 서비스를 연결해 주세요.',
  http_connection_not_found: '이 업무가 쓰던 서비스 연결을 찾지 못했어요. 설정에서 연결을 확인해 주세요.',
  http_post_method_fixed: NOT_PERMITTED_METHOD,
  unsupported_method: NOT_PERMITTED_METHOD,
  http_request_method_read_only: NOT_PERMITTED_METHOD,
  http_body_too_large: '보낼 내용이 너무 커요.',
  http_body_not_serializable: '보낼 내용을 변환하지 못했어요.',
  http_rows_path_required: '가져온 결과에서 표로 쓸 부분을 정해 주세요.',
  invalid_url: BAD_SERVER_ADDRESS,
  invalid_base_url: BAD_SERVER_ADDRESS,
  empty_base_url: BAD_SERVER_ADDRESS,
  invalid_path: BAD_SERVER_ADDRESS,
  unsupported_protocol: UNSAFE_ADDRESS,
  url_credentials_not_allowed: UNSAFE_ADDRESS,
  private_destination_not_allowed: UNSAFE_ADDRESS,
  redirect_not_allowed: UNSAFE_ADDRESS,
  absolute_url_not_allowed: UNSAFE_ADDRESS,
  encoded_path_separator_not_allowed: UNSAFE_ADDRESS,
  invalid_path_encoding: UNSAFE_ADDRESS,
  path_traversal_not_allowed: UNSAFE_ADDRESS,
  url_outside_base: UNSAFE_ADDRESS,
  path_outside_base: UNSAFE_ADDRESS,
  request_timeout: '서버가 제때 응답하지 않았어요. 잠시 후 다시 시도해 주세요.',
  connection_timeout: '서버가 제때 응답하지 않았어요. 잠시 후 다시 시도해 주세요.',
  request_failed: '서버에 연결하지 못했어요. 연결 상태를 확인해 주세요.',
  connection_failed: '서버에 연결하지 못했어요. 연결 상태를 확인해 주세요.',
  path_required: '파일 경로가 비어 있어요.',
  folder_id_required: '어떤 폴더를 볼지 정해지지 않았어요. 폴더를 골라 주세요.',
  folder_not_found: '연결된 폴더를 찾지 못했어요. 설정에서 폴더 연결을 확인해 주세요.',
  folder_scan_limit: '폴더에 파일이 너무 많아 끝까지 확인하지 못했어요.',
  folder_not_accessible: '연결된 폴더를 열 수 없어요. 폴더가 옮겨졌거나 네트워크 드라이브가 끊겼는지 확인해 주세요.',
  folder_not_directory: '연결된 경로가 폴더가 아니에요. 설정에서 폴더 연결을 확인해 주세요.',
  source_folder_not_found: '연결된 폴더를 찾지 못했어요. 설정에서 폴더 연결을 확인해 주세요.',
  folder_scan_incomplete: '폴더를 끝까지 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
  incomplete_scan: '폴더를 끝까지 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
  folder_scan_timeout: '폴더를 확인하는 데 시간이 너무 걸렸어요. 잠시 후 다시 시도해 주세요.',
  scan_timeout: '폴더를 확인하는 데 시간이 너무 걸렸어요. 잠시 후 다시 시도해 주세요.',
  folder_scan_worker_failed: '폴더를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
  not_a_file: '파일이 아닌 항목이라 열지 않았어요.',
  path_outside_source: '연결된 폴더 밖의 파일이라 열지 않았어요.',
  rdb_connection_not_found: '이 업무가 쓰던 데이터베이스 연결을 찾지 못했어요. 설정에서 데이터베이스를 다시 연결해 주세요.',
  rdb_connection_required: '어느 데이터베이스에서 읽을지 정해지지 않았어요. 데이터베이스를 골라 주세요.',
  invalid_grant: 'Google 로그인이 만료됐어요. 설정에서 Gmail을 다시 연결해 주세요.',
  oauth_refresh_failed: 'Google 로그인이 만료됐어요. 설정에서 Gmail을 다시 연결해 주세요.',
  gmail_scope_missing: 'Gmail 권한이 부족해요. 설정에서 Gmail을 다시 연결해 주세요.',
  gmail_rate_limited: 'Gmail 요청이 잠시 너무 많았어요. 잠시 후 다시 시도해 주세요.',
  gmail_unavailable: 'Gmail이 잠시 응답하지 않았어요. 잠시 후 다시 시도해 주세요.',
  'fetch failed': '서버에 연결하지 못했어요. 인터넷 연결과 서버 주소를 확인해 주세요.',
  file_not_accessible: '파일을 열 수 없어요. 파일이 있는지 확인해 주세요.',
  file_path_not_authorized: '연결된 폴더 밖의 파일이라 열지 않았어요.',
  sheet_not_found: '시트를 찾지 못했어요. 시트 이름을 확인해 주세요.',
  'template required': '서식 파일이 필요해요. 서식 파일을 골라 주세요.',
  'html required': '문서 내용이 비어 있어요.',
  document_id_required: DOCUMENT_MISSING,
  chunk_id_required: DOCUMENT_MISSING,
  page_index_required: DOCUMENT_MISSING,
  page_index_invalid: DOCUMENT_MISSING,
  table_input_required: '이전 단계에서 표를 받지 못했어요.',
  table_input_invalid: '표 형식이 올바르지 않아요.',
  document_input_required: '이전 단계에서 문서를 받지 못했어요.',
  http_response_required: '이전 단계에서 가져온 결과가 없어요.',
  http_response_invalid: '가져온 결과 형식이 올바르지 않아요.',
  invalid_transform_expr: '계산식이 올바르지 않아요.',
  openapi_spec_not_found: '서비스 설명을 찾지 못했어요. 연결 설정을 확인해 주세요.',
  openapi_operation_not_found: '서비스에서 요청할 기능을 찾지 못했어요.',
  openapi_request_body_required: '보낼 내용이 비어 있어요.',
  openapi_security_headers_required: '서비스 로그인 정보가 필요해요. 설정에서 연결을 확인해 주세요.',
};

function httpStatusMessage(status: number): string {
  if (status === 401 || status === 403) return '서버가 접근을 거부했어요. 연결의 로그인 정보를 확인해 주세요.';
  if (status === 404) return '서버에서 요청한 자료를 찾지 못했어요. 서버 주소와 경로를 확인해 주세요.';
  if (status === 408 || status === 429) return '서버가 지금 요청을 받지 못했어요. 잠시 후 다시 시도해 주세요.';
  if (status >= 500) return '서버에 문제가 있어 응답하지 못했어요. 잠시 후 다시 시도해 주세요.';
  return '서버가 요청을 처리하지 못했어요. 보낸 값을 확인해 주세요.';
}

/**
 * A connector's `error` string as a sentence for the activity log and chat.
 * Korean and other readable messages pass through; machine codes are translated.
 */
export function connectorErrorMessage(error?: string | null): string {
  const text = error?.trim() ?? '';
  if (!text) return GENERIC;
  if (Object.hasOwn(CONNECTOR_ERROR_MESSAGES, text)) return CONNECTOR_ERROR_MESSAGES[text]!;
  // Slack's SDK reports its platform code inside English text ("An API error occurred: not_in_channel").
  const slackCode = /^An API error occurred: ([a-z_]+)$/u.exec(text)?.[1];
  if (slackCode) {
    if (Object.hasOwn(CONNECTOR_ERROR_MESSAGES, slackCode)) return CONNECTOR_ERROR_MESSAGES[slackCode]!;
    return slackErrorMessage(slackCode) ?? GENERIC;
  }
  const status = /^http_(\d{3})$/u.exec(text)?.[1];
  if (status) return httpStatusMessage(Number(status));
  if (/^Unknown(?: or denied)? \S+ action\b/u.test(text)) return '이 단계에서 지원하지 않는 작업이에요.';
  if (/^Unsupported .*fields$/u.test(text)) return '이 서비스에서 지원하지 않는 보내기 옵션이 들어 있어요.';
  if (text.startsWith('openapi_required_parameter_missing')) return '요청에 필요한 값이 비어 있어요.';
  if (text.startsWith('html_template_render_failed')) return '문서 서식을 채우지 못했어요. 서식 파일을 확인해 주세요.';
  // A bare snake_case token is a code nobody wrote words for yet; never show it raw.
  if (/^[a-z0-9]+(?:[_:.-][a-z0-9]+)+$/iu.test(text)) return GENERIC;
  return text;
}

const READ_FAILURE_BY_KIND: Record<string, string> = {
  not_found: '찾는 자료를 찾지 못했어요. 이름이나 조건을 확인해 주세요.',
  permission_denied: '이 자료에 접근할 권한이 없어요. 설정에서 연결을 다시 확인해 주세요.',
  host_policy: '허용되지 않은 자료라 가져오지 않았어요.',
  invalid_request: '자료를 가져올 조건이 올바르지 않아요. 요청을 조금 바꿔 다시 해 주세요.',
  transient: '연결된 서비스가 잠시 응답하지 않았어요. 잠시 후 다시 시도해 주세요.',
};

/**
 * What to tell the person when a read failed: the connector's error in words, or, for an error
 * nobody wrote words for (or provider English), what kind of failure it was. Never the raw code.
 */
export function readFailureMessage(error?: string | null, failureKind?: string): string {
  const translated = connectorErrorMessage(error);
  if (translated !== GENERIC && /[가-힣]/u.test(translated)) return translated;
  return (failureKind && READ_FAILURE_BY_KIND[failureKind]) ?? GENERIC;
}

/** Slack's own error codes (from its API text "An API error occurred: invalid_auth") as what to do. */
const SLACK_ERROR_MESSAGES: Record<string, string> = {
  invalid_auth: 'Slack 토큰이 올바르지 않아요. Slack 앱 설정에서 토큰을 다시 복사해 붙여 넣어 주세요.',
  not_authed: 'Slack 토큰이 비어 있어요. Slack 앱 설정에서 토큰을 복사해 붙여 넣어 주세요.',
  token_revoked: 'Slack 토큰이 취소됐어요. Slack 앱을 다시 설치한 뒤 새 토큰을 넣어 주세요.',
  token_expired: 'Slack 토큰이 만료됐어요. Slack 앱 설정에서 새 토큰을 넣어 주세요.',
  account_inactive: '이 Slack 토큰의 계정이나 앱이 비활성화됐어요. Slack 앱을 다시 설치해 주세요.',
  missing_scope: 'Slack 앱에 필요한 권한이 빠져 있어요. 연결 안내의 권한을 추가하고 앱을 다시 설치해 주세요.',
  not_allowed_token_type: '다른 종류의 Slack 토큰을 넣었어요. 봇 토큰(xoxb-)과 실시간 수신 토큰(xapp-) 자리를 확인해 주세요.',
  ratelimited: 'Slack 요청이 잠시 너무 많았어요. 잠시 후 다시 시도해 주세요.',
};

export function slackErrorMessage(error?: string | null): string | undefined {
  const text = error?.trim() ?? '';
  if (!text) return undefined;
  const code = /(?:An API error occurred: |^)([a-z_]+)$/u.exec(text)?.[1];
  if (code && Object.hasOwn(SLACK_ERROR_MESSAGES, code)) return SLACK_ERROR_MESSAGES[code];
  if (/[\uac00-\ud7a3]/u.test(text)) return text;
  return 'Slack에 연결하지 못했어요. 토큰과 인터넷 연결을 확인해 주세요.';
}

const AI_TIMEOUT = 'AI 응답이 너무 오래 걸려 멈췄습니다. 잠시 후 다시 시도해 주세요.';
const AI_AUTH = 'AI 연결 정보가 올바르지 않습니다. 설정 > AI에서 확인해 주세요.';
const AI_BUSY = 'AI 서비스가 잠시 바쁩니다. 잠시 후 다시 시도해 주세요.';
const AI_MISSING = 'AI 프로그램을 찾지 못했습니다. 설정 > AI에서 연결 상태를 확인해 주세요.';
const AI_UNREACHABLE = 'AI에 연결하지 못했습니다. AI 프로그램(예: Ollama)이 켜져 있는지, 설정 > AI의 주소가 맞는지 확인해 주세요.';
const AI_MODEL_MISSING = '설정한 AI 모델을 찾지 못했습니다. 설정 > AI에서 모델 이름을 확인해 주세요.';

const AI_TIMEOUT_CODES = new Set(['agent_timeout']);
const AI_TIMEOUT_TEXT = /^(?:Agent timed out after \d+ms|ax_command_chat_timeout|TypeSafe request timed out\.?)$/u;
const AI_AUTH_TEXT = /invalid[ _-]?(?:x-)?api[ _-]?key|incorrect api key|authentication_error|\b401 unauthorized\b|\bstatus:? 401\b|not logged in|please run \/login|\binvalid bearer token\b/iu;
const AI_BUSY_TEXT = /rate[ _-]?limit|too many requests|overloaded|\bstatus:? (?:429|529)\b|\bapi error:? (?:429|529)\b/iu;
const AI_MISSING_TEXT = /^spawn \S+ ENOENT$|is not recognized as an internal or external command|command not found/iu;
const AI_UNREACHABLE_TEXT = /ECONNREFUSED|Cannot connect to API|fetch failed|ENOTFOUND/iu;
const AI_MODEL_MISSING_TEXT = /model ['"]?[^'"]*['"]? not found|model_not_found|does not exist or you do not have access/iu;

function errorField(error: unknown, field: 'code' | 'status' | 'statusCode' | 'syscall' | 'message' | 'cause' | 'lastError'): unknown {
  return error && typeof error === 'object' && field in error ? (error as Record<string, unknown>)[field] : undefined;
}

/**
 * The common AI provider failures (timeout, bad sign-in or key, busy, CLI missing) as a sentence
 * with what to do, or undefined when the error is something else. Looks through `cause` too,
 * since decision and harness layers wrap provider errors. Korean messages that match none of
 * the machine signals pass through unchanged (undefined) so their own wording is kept.
 */
export function aiProviderErrorMessage(error: unknown): string | undefined {
  const chain: unknown[] = [];
  // Wrapped errors keep the provider's own in `cause`; the AI SDK's retry error keeps it in `lastError`.
  for (let current: unknown = error; current != null && chain.length < 5;
    current = errorField(current, 'cause') ?? errorField(current, 'lastError')) {
    chain.push(current);
  }
  const text = (entry: unknown) => {
    const message = entry instanceof Error ? entry.message : typeof entry === 'string' ? entry : errorField(entry, 'message');
    return typeof message === 'string' ? message.trim() : '';
  };
  for (const entry of chain) {
    const code = errorField(entry, 'code');
    const status = errorField(entry, 'status') ?? errorField(entry, 'statusCode');
    const syscall = errorField(entry, 'syscall');
    if ((typeof code === 'string' && AI_TIMEOUT_CODES.has(code)) || AI_TIMEOUT_TEXT.test(text(entry))) return AI_TIMEOUT;
    if (status === 401 || status === 403) return AI_AUTH;
    if (status === 429 || status === 503 || status === 529) return AI_BUSY;
    if (code === 'ENOENT' && typeof syscall === 'string' && syscall.startsWith('spawn')) return AI_MISSING;
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') return AI_UNREACHABLE;
  }
  if (/[가-힣]/u.test(text(error))) return undefined;
  for (const entry of chain) {
    const message = text(entry);
    if (!message) continue;
    if (AI_MISSING_TEXT.test(message)) return AI_MISSING;
    if (AI_AUTH_TEXT.test(message)) return AI_AUTH;
    if (AI_BUSY_TEXT.test(message)) return AI_BUSY;
    if (AI_MODEL_MISSING_TEXT.test(message)) return AI_MODEL_MISSING;
    if (AI_UNREACHABLE_TEXT.test(message)) return AI_UNREACHABLE;
  }
  return undefined;
}
