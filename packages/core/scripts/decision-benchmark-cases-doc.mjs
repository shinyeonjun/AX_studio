// Writes docs/evaluation/decision-benchmark-cases.md from the case files, so the list of what the
// decision benchmark asks can never drift from what it runs:
//   node scripts/decision-benchmark-cases-doc.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evalDir = join(root, 'src/intelligence/commands/chat/routing/eval');
const jiti = createJiti(import.meta.url);
const cases = await jiti.import(join(evalDir, 'routing-eval.cases.ts'));
const holdout = await jiti.import(join(evalDir, 'routing-eval.holdout-cases.ts'));
const { BASIC_CONNECTIONS } = await jiti.import(join(evalDir, 'routing-eval.workspace.ts'));
const { SCALE_CONNECTIONS } = await jiti.import(join(evalDir, 'routing-eval.scale-fixture.ts'));

const SETS = [
  { name: '기존 basic', set: 'main', workspace: 'basic', list: cases.JEV_ROUTING_CASES },
  { name: '기존 scale', set: 'main', workspace: 'scale', list: cases.JEV_SCALE_ROUTING_CASES },
  { name: '홀드아웃 v1 basic', set: 'holdout-v1', workspace: 'basic', list: holdout.HOLDOUT_BASIC_CASES },
  { name: '홀드아웃 v1 scale', set: 'holdout-v1', workspace: 'scale', list: holdout.HOLDOUT_SCALE_CASES },
  { name: '홀드아웃 v2 basic', set: 'holdout-v2', workspace: 'basic', list: holdout.HOLDOUT2_BASIC_CASES ?? [] },
  { name: '홀드아웃 v2 scale', set: 'holdout-v2', workspace: 'scale', list: holdout.HOLDOUT2_SCALE_CASES ?? [] },
];

const KIND = { reply: 'AI 답변', command: '실행 결정', clarify: '되묻기', previous_result: '이전 표로 답', fallback: '처리 안 함', parameterized: '값 입력 요청' };
const ROUTE = {
  workflow_create: '업무 만들기', job_propose: '업무 제안', workflow_list: '업무 목록', connection_list: '연결 목록',
  source_list: '자료 목록', resource_list: '자료 목록', context_remember: '기억하기', report_generate: '보고서 작성',
  execution_enqueue_once: '한 번 실행(발송 등)',
};
const CAPABILITY = {
  'rdb.query.read': 'DB 조회', 'http.request': 'API 조회', 'gmail.messages.search': '메일 검색', 'gmail.messages.read': '메일 읽기',
  'slack.channels.list': 'Slack 채널 목록', 'slack.messages.search': 'Slack 메시지 검색', 'slack.messages.read': 'Slack 메시지 읽기',
  'local_folder.list': '폴더 파일 목록', 'local_sheet.read': '스프레드시트 읽기',
};
const TRANSFORM = { calculate: '계산', filter: '필터', sort: '정렬', filter_sort: '필터·정렬', none: '그대로' };
const any = (values, labels) => [values].flat().map((value) => labels?.[value] ?? `\`${value}\``).join(' 또는 ');

/** The expectation in words: what must happen for the case to pass (routingMiss). */
function expected(expect) {
  const parts = [any(expect.kind, KIND)];
  if (expect.route) parts.push(`경로 ${any(expect.route, ROUTE)}`);
  if (expect.capabilityId) parts.push(any(expect.capabilityId, CAPABILITY));
  for (const [key, value] of Object.entries(expect.params ?? {})) {
    parts.push(`${{ connectionId: '연결', table: '테이블', path: '경로' }[key] ?? key} ${any(value)}`);
  }
  if (expect.join) parts.push(`join ${any(expect.join)}`);
  if (expect.tableTransform) parts.push(`표 처리 ${any(expect.tableTransform, TRANSFORM)}`);
  if (expect.sourceChooser) parts.push('"어디에서 찾을까요?" 선택지');
  return parts.join(' · ');
}

/** A category from the expectation alone, so the count table is the same for every reader. */
function category(testCase) {
  const { expect } = testCase;
  if (expect.sourceChooser) return '출처가 겹쳐 되묻기';
  if (expect.kind.includes('previous_result')) return '이전 표 후속 질문';
  if (expect.kind.length === 1 && expect.kind[0] === 'reply') return '대화·설명';
  const routes = [expect.route ?? []].flat();
  if (routes.some((route) => route === 'workflow_create' || route === 'job_propose')) return '반복·자동 업무 만들기';
  if (routes.length) return '목록·기억·발송·보고서';
  const capabilities = [expect.capabilityId ?? []].flat();
  if (capabilities.includes('http.request') && !capabilities.includes('rdb.query.read')) return 'API 조회';
  if (capabilities.some((id) => /^(gmail|slack|local_)/u.test(id))) return '메일·Slack·폴더';
  if (expect.tableTransform) return 'DB 조회 + 계산·필터·정렬';
  return 'DB 조회';
}

function describeWorkspace(connections) {
  const lines = [];
  for (const connection of connections) {
    const config = connection.config;
    if (connection.connector === 'rdb') {
      const databases = config.databases ?? [{ id: '(기본)', ...config }];
      for (const database of databases) {
        lines.push(`- **DB ${database.label}** (\`${database.id}\`): ${database.schema.tables.map((table) => `\`${table.table}\``).join(', ')}`);
      }
    } else if (connection.connector === 'http') {
      for (const endpoint of config.endpoints) {
        lines.push(`- **API ${endpoint.label}** (\`${endpoint.id}\`): ${endpoint.discoveredReadOperations.map((operation) => `\`${operation.path}\``).join(', ')}`);
      }
    } else if (connection.connector === 'local_folder') {
      lines.push(`- **폴더**: ${config.folders.map((folder) => folder.label).join(', ')}`);
    } else {
      lines.push(`- **${{ gmail: 'Gmail', slack: 'Slack' }[connection.connector] ?? connection.connector}**`);
    }
  }
  return lines.join('\n');
}

const all = SETS.flatMap((entry) => entry.list.map((testCase) => ({ ...testCase, entry })));
const categories = [...new Set(all.map(category))];
const countRow = (filter) => categories.map((name) => all.filter((testCase) => filter(testCase) && category(testCase) === name).length);
const setGroups = [
  ['기존 (49)', (testCase) => testCase.entry.set === 'main'],
  ['홀드아웃 v1', (testCase) => testCase.entry.set === 'holdout-v1'],
  ['홀드아웃 v2', (testCase) => testCase.entry.set === 'holdout-v2'],
];

const out = [
  '# 판단 벤치마크 케이스 목록',
  '',
  '> 자동 생성 문서입니다. 케이스를 바꾼 뒤 `node scripts/decision-benchmark-cases-doc.mjs`(packages/core)로 다시 만듭니다.',
  '> 결과와 분석: [jev-vs-codex-decision.md](jev-vs-codex-decision.md)',
  '',
  '## 무엇을 묻는 벤치마크인가',
  '',
  '사용자의 채팅 요청 하나를 받았을 때 앱이 **무엇을 할지** 고르는 판단을 채점합니다.',
  '- 고르는 것: AI 답변인지, 어떤 자료(DB 테이블, API 경로, 메일, Slack, 폴더)를 읽을지, 표를 어떻게 처리할지, 업무를 만들지, 사용자에게 되물을지',
  '- 실제 조회나 발송은 하지 않습니다. 연결은 모두 가짜 메타데이터(이름, 컬럼, 경로)입니다.',
  '- 채점은 `routingMiss`(routing-eval.cases.ts)로 합니다. 결과 종류가 기대 목록 안에 있어야 하고, 경로·도구·연결·테이블·경로·join·표 처리 중 **케이스에 적힌 것만** 맞으면 통과입니다. 적히지 않은 부분은 자유입니다.',
  '- "또는"으로 적힌 것은 어느 쪽이든 정답입니다(둘 다 합리적인 경우).',
  '',
  '## 세트',
  '',
  '| 세트 | 건수 | 만든 방식 |',
  '|---|---|---|',
  `| 기존 basic / scale | ${cases.JEV_ROUTING_CASES.length} / ${cases.JEV_SCALE_ROUTING_CASES.length} | 매일 도는 Jev 평가 세트. Jev가 실제로 틀린 사례를 추가하고 앱을 고쳐 통과시키며 자란 세트라 **Jev에 맞춰져 있음** |`,
  `| 홀드아웃 v1 basic / scale | ${holdout.HOLDOUT_BASIC_CASES.length} / ${holdout.HOLDOUT_SCALE_CASES.length} | 2026-10-13, 어느 엔진도 돌리기 전에 작성. 이후 수정 없음 |`,
  `| 홀드아웃 v2 basic / scale | ${(holdout.HOLDOUT2_BASIC_CASES ?? []).length} / ${(holdout.HOLDOUT2_SCALE_CASES ?? []).length} | 2026-10-14, 결과를 보지 않은 별도 작성자(에이전트)가 미리 정한 분류별 할당량대로 작성. 별도 검토 후 실행 전에 커밋 |`,
  '',
  '## 분류별 건수',
  '',
  `| 분류 | ${setGroups.map(([name]) => name).join(' | ')} | 합계 |`,
  `|---|${setGroups.map(() => '---').join('|')}|---|`,
  ...categories.map((name, index) => {
    const counts = setGroups.map(([, filter]) => countRow(filter)[index]);
    return `| ${name} | ${counts.join(' | ')} | ${counts.reduce((a, b) => a + b, 0)} |`;
  }),
  `| **합계** | ${setGroups.map(([, filter]) => all.filter(filter).length).join(' | ')} | ${all.length} |`,
  '',
  '분류는 기대값에서 자동으로 정합니다(이 스크립트의 `category`).',
  '',
  '## 연결 환경',
  '',
  '### basic: 작은 팀 (요청당 판단 질문 약 28개)',
  '',
  describeWorkspace(BASIC_CONNECTIONS),
  '',
  '### scale: 회사 규모 (요청당 판단 질문 약 174개)',
  '',
  'orders·customers·users처럼 같은 이름이 여러 곳에 있고, ERP 테이블은 약어 이름입니다.',
  '',
  describeWorkspace(SCALE_CONNECTIONS),
  '',
  '## 케이스',
  '',
];
for (const entry of SETS) {
  if (entry.list.length === 0) continue;
  out.push(`### ${entry.name} (${entry.list.length})`, '', '| id | 요청 | 분류 | 정답 조건 |', '|---|---|---|---|');
  for (const testCase of entry.list) {
    const context = [
      testCase.previous ? '직전 답에 주문 표(3행)가 있음' : undefined,
      testCase.pastChoices ? `지난 선택: ${testCase.pastChoices.map((choice) => `"${choice.request}" → ${choice.place}`).join(', ')}` : undefined,
    ].filter(Boolean).join('; ');
    out.push(`| \`${testCase.id}\` | ${testCase.message}${context ? ` _(${context})_` : ''} | ${category(testCase)} | ${expected(testCase.expect)} |`);
  }
  out.push('');
}

const target = join(root, '../../docs/evaluation/decision-benchmark-cases.md');
writeFileSync(target, `${out.join('\n')}\n`);
console.log(`wrote ${target}: ${all.length} cases`);
