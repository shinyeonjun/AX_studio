# Interview module

Workflow design interview: natural language → **workflow graph** + **action instances** → `WorkflowIR`.

## Flow

```text
discover → plan/replan → patch → compile → assessCompleteness
```

- **plan**: AI creates node graph once; required params seeded empty from catalog.
- **patch**: fills `{nodeId}.params.{field}` and `{nodeId}.memo` (ai_decision criteria) without changing structure.
- **compile**: code merges graph + `actions` map and builds Workflow IR. `ai_decision.memo` is passed to runtime investigate agent.

## Work scope

At session start the user picks **once** (`일회성`) or **recurring** (`다회성`):

| Scope | Trigger handling |
|---|---|
| `once` | one-time scope; the plan chooses `manual` for now or `once` with `runAt` for a future execution |
| `recurring` | trigger collected via chat interview → AI `patch.set` |

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

Action **definitions** (input/output, labels) live in the global capability catalog — not per workflow.

## Layout

| Directory | Responsibility |
|-----------|----------------|
| `session/` | Turn loop, state, assistant messages, workflow merge |
| `draft/` | Canvas schema (`InterviewDraft`), `actions` map, local-folder normalization |
| `compile/` | Draft → IR builder |
| `slots/` | Node slot IDs, patch, requiredness, prompt formatting |
| `plan/` | AI structural plan schema and normalization |
| `agent/` | Provider output contract, wire envelope, discovery loop |
| `resources/` | Connected folders/files for agent prompts |
| `presentation/` | Chat summaries and workflow documents |
| `revision/` | Post-save workflow revision |
| `bootstrap/` | Resume interview from saved workflow |
| `test/` | Tests mirroring module layout |

## Slot IDs

Action parameters use **node-scoped** keys: `critical_slack.params.channel`.

Trigger and workflow-level slots stay global: `trigger.runAt`, `goal`, `slack.new_message.channel`.

## Roles

| Layer | Owns | Does not |
|---|---|---|
| AI | plan/replan, patch.set, memo, `nextQuestion` interview | Merge workflow JSON, parse user chat for slot values |
| Code | merge patch/plan, compile, contract + graph validation, completeness | Replace AI questions with generic “fill the panel” copy |
| UI | render `InterviewDraft`, read-only node detail panel | Action param forms; numbered chat lists |

`done` follows `completeness.deployable` only. While incomplete, chat shows the AI `nextQuestion` (one natural interview question per turn). Channels, recipients, memo, and recurring triggers are collected via chat interview → AI `patch.set`. The right-side panel shows read-only status and connection guidance.

## UI

The right-side graph renders **`state.workflow` (InterviewDraft) only** — not raw AI output. Action display resolves `actionRef` + `actions[nodeId].params` via the catalog.

**Trigger** for once scope is fixed to manual; for recurring scope it is collected in chat. **Action params** are also collected in chat. The node detail panel is read-only and points users to chat for missing values.
