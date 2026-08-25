import type { ProductSurfaceArea } from '../lib/types.js';

export type SurfaceSideEffect = 'none' | 'write';

export interface ProductSurface {
  id: string;
  area: ProductSurfaceArea;
  title: string;
  /** Currently shipped to users. Hidden/unfinished stays false. */
  productReady: boolean;
  sideEffect: SurfaceSideEffect;
  prompt: string;
  nav?: {
    tab?: 'work' | 'approval' | 'activity' | 'settings';
    settingsLabel?: string;
    aiBrand?: 'Claude' | 'GPT';
    pageTitle?: string;
  };
}

const PROBE =
  '외부로 보내거나 저장·삭제하지 마. 현재 연결 상태 기준으로 이 제품이 할 수 있는지 한 문장으로 판단하고, 못하면 부족한 연결을 말해.';

function capability(id: string, title: string, verb: string, sideEffect: SurfaceSideEffect = 'none'): ProductSurface {
  return {
    id: `capability:${id}`,
    area: 'capability',
    title,
    productReady: true,
    sideEffect,
    prompt: `${verb} ${PROBE}`,
  };
}

function command(id: string, title: string, verb: string, sideEffect: SurfaceSideEffect = 'none'): ProductSurface {
  return {
    id: `command:${id}`,
    area: 'command',
    title,
    productReady: true,
    sideEffect,
    prompt: `${verb} ${PROBE}`,
  };
}

export const PRODUCT_SURFACES: ProductSurface[] = [
  {
    id: 'nav:work',
    area: 'nav',
    title: '업무 탭',
    productReady: true,
    sideEffect: 'none',
    prompt: '',
    nav: { tab: 'work' },
  },
  {
    id: 'nav:approval',
    area: 'nav',
    title: '승인 탭',
    productReady: true,
    sideEffect: 'none',
    prompt: '',
    nav: { tab: 'approval', pageTitle: '승인' },
  },
  {
    id: 'nav:activity',
    area: 'nav',
    title: '활동 탭',
    productReady: true,
    sideEffect: 'none',
    prompt: '',
    nav: { tab: 'activity', pageTitle: '활동' },
  },
  {
    id: 'nav:settings',
    area: 'nav',
    title: '설정 탭',
    productReady: true,
    sideEffect: 'none',
    prompt: '',
    nav: { tab: 'settings', settingsLabel: '설정 홈', pageTitle: '설정' },
  },
  {
    id: 'settings:ai-claude',
    area: 'ai',
    title: 'Claude 설정',
    productReady: true,
    sideEffect: 'none',
    prompt: '',
    nav: { tab: 'settings', aiBrand: 'Claude', pageTitle: 'Claude' },
  },
  {
    id: 'settings:ai-gpt',
    area: 'ai',
    title: 'GPT 설정',
    productReady: true,
    sideEffect: 'none',
    prompt: '',
    nav: { tab: 'settings', aiBrand: 'GPT', pageTitle: 'GPT' },
  },
  {
    id: 'settings:slack',
    area: 'connector',
    title: 'Slack 연결',
    productReady: true,
    sideEffect: 'none',
    prompt: '',
    nav: { tab: 'settings', settingsLabel: 'Slack', pageTitle: 'Slack 연결' },
  },
  {
    id: 'settings:gmail',
    area: 'connector',
    title: 'Gmail 연결',
    productReady: true,
    sideEffect: 'none',
    prompt: '',
    nav: { tab: 'settings', settingsLabel: 'Gmail', pageTitle: 'Gmail 연결' },
  },
  {
    id: 'settings:local-folder',
    area: 'connector',
    title: '로컬 폴더 연결',
    productReady: true,
    sideEffect: 'none',
    prompt: '',
    nav: { tab: 'settings', settingsLabel: '로컬 폴더', pageTitle: '로컬 폴더 연결' },
  },
  {
    id: 'settings:http',
    area: 'connector',
    title: 'HTTP API 연결',
    productReady: true,
    sideEffect: 'none',
    prompt: '',
    nav: { tab: 'settings', settingsLabel: 'HTTP API', pageTitle: 'HTTP API 연결' },
  },
  {
    id: 'settings:webhook',
    area: 'connector',
    title: 'Webhook 수신',
    productReady: true,
    sideEffect: 'none',
    prompt: '',
    nav: { tab: 'settings', settingsLabel: 'Webhook', pageTitle: 'Webhook 수신' },
  },
  {
    id: 'settings:rdb',
    area: 'connector',
    title: '데이터베이스 연결',
    productReady: true,
    sideEffect: 'none',
    prompt: '',
    nav: { tab: 'settings', settingsLabel: '데이터베이스', pageTitle: '데이터베이스 연결' },
  },
  {
    id: 'settings:hidden-openapi-mcp',
    area: 'settings',
    title: '미구현 OpenAPI/MCP는 설정에 안 보임',
    productReady: false,
    sideEffect: 'none',
    prompt: '',
    nav: { tab: 'settings', settingsLabel: '설정 홈', pageTitle: '설정' },
  },
  {
    id: 'chat:new-send-reply',
    area: 'chat',
    title: '새 대화 전송과 응답',
    productReady: true,
    sideEffect: 'none',
    prompt: '한 문장으로 네가 할 수 있는 일만 말해. 외부 전송 금지.',
  },
  {
    id: 'chat:long-message',
    area: 'chat',
    title: '긴 메시지',
    productReady: true,
    sideEffect: 'none',
    prompt: `다음 문장을 읽고 마지막 단어만 답해. ${'가나다라마바사 '.repeat(40)}끝단어는 READY`,
  },
  {
    id: 'session:new-while-sending',
    area: 'session',
    title: '전송 중 새 대화',
    productReady: true,
    sideEffect: 'none',
    prompt: '세션 격리 검사',
  },
  {
    id: 'document:session-pdf',
    area: 'document',
    title: '세션 PDF 자료',
    productReady: true,
    sideEffect: 'none',
    prompt: '이 대화에 올린 PDF가 있으면 파일 이름만 말해. 없으면 없다고 해.',
  },
  {
    id: 'workflow:list-or-explain',
    area: 'workflow',
    title: '업무 목록/설명',
    productReady: true,
    sideEffect: 'none',
    prompt: `저장된 반복 업무가 있으면 이름만, 없으면 없다고 해. ${PROBE}`,
  },
  {
    id: 'discovery:explain',
    area: 'discovery',
    title: '업무 발견 설명',
    productReady: true,
    sideEffect: 'none',
    prompt: `지난 결과물로 반복 업무를 발견하는 기능이 있는지 설명해. 지금은 시작하지 마. ${PROBE}`,
  },
  {
    id: 'runtime:approvals-activity',
    area: 'runtime',
    title: '승인·활동 화면',
    productReady: true,
    sideEffect: 'none',
    prompt: '',
  },

  capability('gmail.messages.read', 'Gmail 읽기', '최근 메일 제목 확인이'),
  capability('gmail.messages.search', 'Gmail 검색', '메일 검색이'),
  capability('gmail.draft.create', 'Gmail 초안', '메일 초안 작성이', 'write'),
  capability('gmail.message.send', 'Gmail 발송', '메일 보내기가', 'write'),
  capability('gmail.new_message', 'Gmail 새 메일 트리거', '새 메일 감시가'),
  capability('slack.channels.list', 'Slack 채널 목록', 'Slack 채널 목록 조회가'),
  capability('slack.messages.search', 'Slack 검색', 'Slack 메시지 검색이'),
  capability('slack.messages.read', 'Slack 읽기', 'Slack 메시지 읽기가'),
  capability('slack.message.send', 'Slack 전송', 'Slack 보내기가', 'write'),
  capability('slack.new_message', 'Slack 새 메시지 트리거', 'Slack 새 메시지 감시가'),
  capability('local_folder.list', '폴더 목록', '연결 폴더 파일 목록 조회가'),
  capability('local_folder.read', '폴더 파일 읽기', '연결 폴더 파일 읽기가'),
  capability('local_folder.new_file', '새 파일 트리거', '폴더 새 파일 감시가'),
  capability('rdb.schema.describe', 'DB 스키마', '연결된 DB 테이블 목록 조회가'),
  capability('rdb.query.read', 'DB 조회', '연결된 DB 읽기 전용 조회가'),
  capability('http.request', 'HTTP GET', '연결된 HTTP API GET이'),
  capability('http.post', 'HTTP POST', '연결된 HTTP POST가', 'write'),
  capability('webhook.inbound', 'Webhook 수신', '로컬 웹훅 수신이'),
  capability('document.ingest', '문서 분석', 'PDF 분석이'),
  capability('document.search', '문서 검색', '분석된 문서 검색이'),
  capability('document.getPage', '문서 페이지', '문서 페이지 읽기가'),
  capability('local_sheet.read', '스프레드시트 읽기', '로컬 시트 읽기가'),
  capability('transform.evaluate', '변환 평가', '필드 변환 평가가'),

  command('command.list', '명령 목록', '호출 가능한 명령 나열이'),
  command('resource.list', '리소스 목록', '연결 리소스 나열이'),
  command('source.list', '소스 목록', '소스 목록 조회가'),
  command('session.source.list', '세션 자료 목록', '이 대화 자료 목록 조회가'),
  command('capability.list', 'capability 목록', 'capability 목록 조회가'),
  command('capability.describe', 'capability 설명', 'capability 설명이'),
  command('workflow.list', '워크플로 목록', '워크플로 목록 조회가'),
  command('workflow.inspect', '워크플로 검사', '워크플로 검사가'),
  command('workflow.validate', '워크플로 검증', '워크플로 검증이'),
  command('workflow.create', '워크플로 생성', '워크플로 생성이', 'write'),
  command('workflow.update', '워크플로 수정', '워크플로 수정이', 'write'),
  command('workflow.delete', '워크플로 삭제', '워크플로 삭제가', 'write'),
  command('workflow.run', '워크플로 실행', '워크플로 실행이', 'write'),
  command('discovery.start', '발견 시작', '업무 발견 시작이', 'write'),
  command('ui.present', 'UI 카드', '확인 카드 표시가'),
];
