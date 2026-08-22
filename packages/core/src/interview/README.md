# Interview module

Workflow design interview: natural language → **workflow graph** + **action instances** → `WorkflowIR`.

## Flow

```text
user message → Agent(read-only tools)* → typed draft patch → code validation → compile → assessCompleteness
```

- `tools`: Agent가 필요할 때 `connections.list`, `sources.files.list`, `capabilities.describe`, `workflow.inspect` 같은 read-only 도구를 호출한다.
- `patch`: Agent가 `meta`, `upsertNodes`, `removeNodeIds`, `set`으로 draft만 수정한다. `baseRevision`이 현재 revision과 다르면 거부한다.
- `compile`: 코드가 draft + `actions` map을 검수하고 Workflow IR을 만든다. `ai_decision.memo`는 runtime investigate agent로 전달된다.
- 저장·승인·실행은 이 인터뷰 Agent의 권한이 아니다. deployable draft가 되면 UI가 저장/실행 동작을 표시한다.
- `workflow.json` 저장은 사용자가 검토 카드에서 명시적으로 누른 경우에만 일어난다. 대화 세션 저장은 draft/history 보존이며 저장된 workflow를 자동으로 덮어쓰지 않는다.

## Work scope

At session start the user picks **once** (`일회성`) or **recurring** (`다회성`):

| Scope | Trigger handling |
|---|---|
| `once` | code가 `manual` trigger로 고정하고 실행 시 입력을 받는다 |
| `recurring` | trigger 값을 Agent가 `patch.meta`로 제안하고 코드가 검수한다 |

Saved workflows infer scope from trigger type when reopened (`bootstrapInterviewFromWorkflow`).

## Data model

```text
InterviewDraft (in-memory workflow)
├─ nodes[]          # graph: trigger metadata, if branches, ai_decision, action ids
└─ actions{}        # per-node instances: actionRef, params, bindings

Stored (ir_json)
├─ workflow         # graph steps (action steps are id-only)
└─ actions{}        # action instances keyed by node id
```

채팅 세션은 `InterviewState`와 draft revision을 별도로 보존한다. `workflowId`가 있는 기존 업무도 대화 중에는 draft로만 수정되고, 저장 버튼을 누를 때만 새 workflow version으로 검수·저장된다.

Action **definitions** (input/output, labels) live in the global capability catalog — not per workflow.

## Layout

| Directory | Responsibility |
|-----------|----------------|
| `session/` | Turn loop, state, assistant messages, draft apply |
| `draft/` | Canvas schema (`InterviewDraft`), `actions` map, local-folder normalization |
| `compile/` | Draft → IR builder |
| `slots/` | Node slot IDs, patch, requiredness, prompt formatting |
| `agent/` | typed tools/patch output contract and provider-safe wire envelope |
| `resources/` | Connected folders/files for agent prompts |
| `presentation/` | Chat summaries and workflow documents |
| `revision/` | Execution explanation |
| `bootstrap/` | Resume interview from saved workflow |
| `test/` | Tests mirroring module layout |

## Slot IDs

Action parameters use **node-scoped** keys: `critical_slack.params.channel`.

Trigger and workflow-level slots stay global: `trigger.runAt`, `goal`, `slack.new_message.channel`.

## Roles

| Layer | Owns | Does not |
|---|---|---|
| AI | read-only tool calls, typed draft patch, `ai_decision` memo/outputFields, short acknowledgement | Chat question text, `done`, catalog action implementations, side effects |
| Code | patch bounds/revision, graph/compile, completeness, next slot question, deployable completion | Replace user values with guesses |
| UI | render `InterviewDraft`, read-only node detail panel | Action param forms; numbered chat lists |

`done` follows `completeness.deployable` only. While incomplete, chat shows the first unfilled slot question from completeness — not a model-selected question. Channels, recipients, memo, and recurring triggers are filled when the user answers and the Agent writes a bounded patch. The right-side panel shows the current draft revision, read-only status, and connection guidance. A deployable draft still requires an explicit save or run action; the Agent cannot persist or execute it.

## UI

The right-side graph renders **`state.workflow` (InterviewDraft) only** — not raw AI output. Action display resolves `actionRef` + `actions[nodeId].params` via the catalog.

**Trigger** for once scope is fixed to manual; for recurring scope it is collected in chat. **Action params** are also collected in chat. The node detail panel is read-only and points users to chat for missing values.
