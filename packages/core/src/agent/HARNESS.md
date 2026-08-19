# AX Harness 설계 원칙

AX Studio Harness는 Aside류 **실행 Agent**가 아니라 **워크플로우 설계 Agent**입니다.

## Artifact boundary

- Agent → Workflow IR 설계·수정·판단 제안
- Runtime → Trigger·Connector·Approval 실행

## Prompt budget

1. **Small constitution** — `AGENTS.md`는 불변 규칙만 (역할·상태는 동적 주입)
2. **Dynamic capability surface** — 연결됨 + draft 참조 + 같은 connector read cap만
3. **Minimal state** — full workflow JSON 대신 compact state; chat은 summary + 최근 N턴
4. **Code enforces policy** — approval/sideEffect는 validator·runtime; prompt는 중복 설명 최소화

## Roles

| Role | Purpose |
|------|---------|
| `interview` | 대화로 workflow draft → Workflow IR |
| `direct_compile` | 한 번에 draft → Workflow IR |
| `investigate` | runtime evidence 기반 read 제안 |
| `revise` | 기존 워크플로우 수정 제안 |

## Model layer

Harness 아래 `ModelProvider`만 교체합니다. Agent loop는 app/runtime이 orchestration합니다 (`maxTurns: 1`).
