# AX 기본 업무 노드 (Built-in)

앱 커넥터(`connectors/`)와 별도. Agent가 자연어에서 끼워 넣는 **워크플로우 기본 노드** 구현 위치.

범례: **●** 구현됨 · **○** 예정

## Trigger

| 노드 | 상태 | 구현 위치 |
|------|------|-----------|
| Manual | ● | `workflow/schema.ts` → `trigger.type: manual` |
| Schedule | ● | `workflow/schema.ts` + `runtime/scheduler.ts` |
| Once | ● | `workflow/schema.ts` + `runtime/scheduler.ts` |
| Gmail New Message | ● | `triggers/gmail-new-message/` |
| Slack New Message | ● | `triggers/slack-new-message/` |
| Webhook | ○ | `triggers/webhook/` |

## Data

| 노드 | 상태 | 구현 위치 |
|------|------|-----------|
| 값 가져오기 (ref/pick) | ○ | `nodes/data/` |
| Filter | ○ | `nodes/data/filter.ts` |
| 필드 선택·이름 변경 | ○ | `nodes/data/field-map.ts` |
| Gmail Read/Search | ● | `connectors/gmail/` |
| DB Schema / Query | ● | `connectors/rdb/` |
| CSV/XLSX Read | ● | `connectors/local_sheet/` (→ `spreadsheet/` 분리 예정) |
| PDF Read | ○ | `connectors/file/pdf-read.ts` |
| File Read (txt/md/docx) | ○ | `connectors/file/` |

## Transform

Agent가 직접 고르지 않고 자연어에서 삽입. IR action step 또는 전용 transform step.

| 노드 | capability id (안) | 상태 | 구현 위치 |
|------|---------------------|------|-----------|
| Text | `format.text` | ○ | `nodes/transform/text.ts` |
| Date/Time | `format.datetime` | ○ | `nodes/transform/datetime.ts` |
| JSON/Object mapping | `format.object` | ○ | `nodes/transform/object-map.ts` |

## AI

| 노드 | 상태 | 구현 위치 |
|------|------|-----------|
| Summarize / Extract / Classify / Decide | ● | `workflow/schema.ts` → `ai_decision` + `runtime/ai-investigation.ts` |

## Flow

| 노드 | 상태 | 구현 위치 |
|------|------|-----------|
| IF / 분기 | ● | `workflow/schema.ts` → `if` + `runtime/condition-eval.ts` |
| Human Approval | ● | `workflow/schema.ts` → `human_approval` + `runtime/engine.ts` |
| Wait | ○ | `nodes/flow/wait.ts` |
| Retry | ○ | `nodes/flow/retry.ts` |
| Fallback | ○ | `nodes/flow/fallback.ts` |

## Output / Report

| 노드 | 상태 | 구현 위치 |
|------|------|-----------|
| HTML | ● | `connectors/report/` |
| PDF | ● | `connectors/report/` |
| DOCX | ● | `connectors/report/` |
| File Write | ○ | `connectors/file/write.ts` |

## State

워크플로우 로컬 key/value. Trigger cursor와 별개.

| 노드 | capability id (안) | 상태 | 구현 위치 |
|------|---------------------|------|-----------|
| Storage Get | `storage.get` | ○ | `connectors/storage/` or `nodes/state/storage.ts` |
| Storage Set | `storage.set` | ○ | `connectors/storage/` or `nodes/state/storage.ts` |

## SaaS 커넥터 (v1.5 우선)

| 커넥터 | 상태 | 구현 위치 |
|--------|------|-----------|
| Gmail | ● | `connectors/gmail/` |
| Slack | ● | `connectors/slack/` |
| Google Calendar | ○ | `connectors/google-calendar/` |
| Google Drive | ○ | `connectors/google-drive/` |
| Google Sheets | ○ | `connectors/google-sheets/` |

## 범용 Escape Hatch

| 노드 | 상태 | 구현 위치 |
|------|------|-----------|
| HTTP GET | ○ | `connectors/http/get.ts` |
| HTTP POST | ○ | `connectors/http/post.ts` (host allowlist + credential + EXTERNAL) |

## 추가 우선순위 (5)

1. PDF Read → `connectors/file/`
2. Google Calendar → `connectors/google-calendar/`
3. Google Sheets → `connectors/google-sheets/`
4. Formatter → `nodes/transform/`
5. Storage → `connectors/storage/`

## 등록 체크리스트 (새 노드/커넥터)

1. `connectors/capabilities.ts` — catalog id
2. `connectors/catalog.ts` — connectable connector (해당 시)
3. `connectors/registry.ts` — runtime instance
4. `connectors/mocks/index.ts` — dev/test mock
5. `runtime/step-executor.ts` — 실행 분기 (built-in node)
6. `apps/desktop/src/workflow/node-display.ts` — 그래프 라벨
