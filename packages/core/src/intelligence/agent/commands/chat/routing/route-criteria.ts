import type { DecisionInstruction } from '../../../../../contracts/decision.js';

/** Host-supported routes and their decision boundaries; the router owns execution. */
export const JEV_CHAT_ROUTE_CRITERIA = {
  answer: {
    what: 'Explain, summarize, calculate, draft, or clarify the request in a conversational reply based on the available conversation history, memo, or previously displayed table without calling external tools.',
    examples: ['이 가구들의 총 재고 수량과 평균 가격 계산해줘', '방금 나온 상품들 중에서 가장 가성비 좋은 거 추천해줘', '표에 있는 내용 간단히 요약해줘'],
    not_for: 'Fetching fresh external data, or creating, updating, deleting, running, scheduling, or generating a report; choose the matching lifecycle route instead.',
  },
  resource_list: {
    what: 'List connected resources and their safe connection status.',
    examples: ['What is connected?', 'Show my available data sources.'],
  },
  connection_list: {
    what: 'List saved HTTP REST connections or endpoints without revealing credentials.',
    examples: ['Show the APIs I connected.', 'What HTTP endpoints are available?'],
  },
  http_read: {
    what: 'Perform a read-only HTTP GET only when the user explicitly provides the request path.',
    examples: ['Use the DummyJSON connection and call GET products?limit=10.', 'GET /api/v1/orders?status=paid'],
    not_for: 'Natural-language requests that match a discovered API operation; choose capability_read for those. Never infer a path that the user did not provide.',
  },
  capability_read: {
    what: 'Handle a request for connected HTTP API, database, Gmail emails, Slack messages, or local files using one cataloged read-only operation, or ask for clarification when no relevant operation is available.',
    examples: ['DummyJSON에서 상품 5개만 가져와서 이름과 가격을 보여줘.', '이번 달 주문 중 결제 완료된 것만 보여줘.', '최근 온 메일 3개 제목 알려줘', 'Slack 메시지 검색', 'Slack 채널 목록 보여줘'],
    requires: 'Choose only an operation listed in the operation question. If context.read_operation_candidates_deferred is true and read_operation_catalog_size is positive, choose this route for a matching data request; Jev will select from the complete catalog in a follow-up before any command is produced. Otherwise, if the operation question offers only none, do not invent an operation, URL, table, tool, or parameter; ask the user to narrow the request or check the connection.',
    not_for: 'Writes, triggers, operations absent from the connected read catalog, listing the saved works (업무) in AX Studio itself (choose workflow_list), or questions asking to calculate, summarize, or analyze data already retrieved in the conversation (choose answer or previous_result instead).',
  },
  previous_result: {
    what: 'Continue from the structured table result shown immediately before this request, without calling its source again.',
    examples: ['방금 결과에서 재고가 30개 미만인 것만 남겨줘.', '그 표를 가격 낮은 순으로 정리해줘.'],
    requires: 'A previous structured table result is available in the current chat.',
    not_for: 'A fresh data read or a result from an unrelated earlier turn.',
  },
  source_list: {
    what: 'List the registered source accounts and folders (which Gmail account, which Slack workspace, which local folder and its files) without reading message or file content.',
    examples: ['연결된 소스 목록 보여줘', 'List the connected source accounts.'],
    not_for: 'Listing Slack channels, or reading, searching or displaying actual emails, messages or files; choose capability_read instead (e.g. slack.channels.list for Slack 채널 목록).',
  },
  session_source_list: {
    what: 'List documents uploaded to the current chat session.',
    examples: ['What did I upload here?', 'Show the files in this conversation.'],
  },
  source_search: {
    what: 'Search connected local-folder source indexes for information or files.',
    examples: ['Search the connected materials for the contract.'],
  },
  discovery_search: {
    what: 'Search the connected catalog for tools, database tables, REST endpoints, folders, or connectors.',
    examples: ['Find the order table.', 'What tool can read customer data?'],
  },
  workflow_list: {
    what: 'List the saved works (업무: saved workflows, recurring and scheduled jobs) and their current versions.',
    examples: ['저장된 업무 뭐 있어?', '등록해 둔 반복 업무 알려줘', 'Show my workflows.'],
  },
  workflow_inspect: {
    what: 'Inspect the current workflow definition and validation state.',
    requires: 'A current workflow is present in the chat context.',
  },
  workflow_validate: {
    what: 'Validate the current workflow against schemas, capabilities, and connection state.',
    requires: 'A current workflow is present in the chat context.',
  },
  workflow_run: {
    what: 'Run the already selected saved workflow now.',
    requires: 'The user explicitly asks to start or run it now, and a current workflow is present.',
    not_for: 'Planning, inspecting, validating, creating, or merely discussing a workflow.',
  },
  workflow_create: {
    what: 'Create and save a new manual workflow from connected operations selected by Jev and compiled by the host.',
    not_for: 'A one-time execution, a recurring job proposal, editing an existing workflow, or merely discussing a workflow.',
  },
  workflow_update: {
    what: 'Update the currently selected saved workflow by changing explicitly quoted name, goal, or success text, adding connected operation steps selected from the live catalog, or removing one explicitly identified existing step.',
    requires: 'A current workflow is present in the chat context.',
    not_for: 'Editing an existing action step, changing triggers or schedules, deleting the workflow, running it, or changing only temporary chat context.',
  },
  workflow_delete: {
    what: 'Delete the currently selected saved workflow only when the user explicitly asks for deletion.',
    requires: 'A current workflow is present in the chat context and the user explicitly asks to delete it.',
    not_for: 'Archiving, pausing, updating, or merely discussing a workflow.',
  },
  execution_enqueue_once: {
    what: 'Queue a typed one-time plan made from connected catalog operations without saving a workflow. The host owns parameter values, data bindings, validation, and approval.',
    not_for: 'Saving a reusable workflow, scheduling recurring work, or running an already saved workflow.',
  },
  context_remember: {
    what: 'Propose remembering an explicit user-authored preference or rule in the current session or workflow. The host must show the exact text and require the user to choose a save action before anything is stored.',
    not_for: 'Explaining memory, discussing hypothetical saving, or saving text that is not explicitly present in the user request.',
  },
  job_propose: {
    what: 'Prepare a supported recurring job proposal for host confirmation. It must not save or activate the job by itself.',
    not_for: 'A one-time execution, immediate workflow run, or a normal conversational answer.',
  },
  report_generate: {
    what: 'Generate a new PDF report from the current chat session using one blank PDF template and one completed PDF example.',
    requires: 'The current chat has two different ready PDF sources and the user asks to generate the report.',
    not_for: 'Explaining a PDF, listing files, or asking how report generation works.',
  },
} satisfies Record<string, DecisionInstruction>;

export type JevChatRouteName = keyof typeof JEV_CHAT_ROUTE_CRITERIA;
