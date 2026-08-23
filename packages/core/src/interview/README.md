# Workflow canvas module

This legacy-named module contains the workflow canvas schema and compiler. It is not an Agent session or persistence layer.

## Flow

```text
command result → host validation → canvas projection → compile → assessCompleteness
```

- `compile`: 코드가 draft + `actions` map을 검수하고 Workflow IR을 만든다. `ai_decision.memo`는 runtime investigate agent로 전달된다.
- 저장·승인·실행은 command host와 Runtime의 권한이다.

## Data model

```text
InterviewDraft (in-memory workflow)
├─ nodes[]          # graph: trigger metadata, if branches, ai_decision, action ids
└─ actions{}        # per-node instances: actionRef, params, bindings

Stored (ir_json)
├─ workflow         # graph steps (action steps are id-only)
└─ actions{}        # action instances keyed by node id
```

Action **definitions** (input/output, labels) live in the global capability catalog — not per workflow.

## Layout

| Directory | Responsibility |
|-----------|----------------|
| `draft/` | Canvas schema (`InterviewDraft`) and action instances |
| `compile/` | Draft → IR builder |
| `slots/` | Node slot IDs and completeness |
| `presentation/` | Chat summaries and workflow documents |
| `revision/` | Execution explanation |
| `test/` | Tests mirroring module layout |

## Slot IDs

Action parameters use **node-scoped** keys: `critical_slack.params.channel`.

Trigger and workflow-level slots stay global: `trigger.runAt`, `goal`, `slack.new_message.channel`.

## Roles

| Layer | Owns | Does not |
|---|---|---|
| Agent | command selection and bounded arguments | direct state mutation, connector calls, side effects |
| Host | command validation, workflow projection, completeness | inventing identifiers or bypassing contracts |
| UI | render the canonical workflow view | executing actions from a visual node |

The host decides whether the workflow is complete from `completeness.deployable`. The Agent does not decide completion and cannot persist or execute a workflow directly.

## UI

The right-side graph renders the host's canonical workflow view, not raw Agent output. Action display resolves `actionRef` + `actions[nodeId].params` via the catalog. The node detail panel is read-only; mutation happens through the command protocol.
