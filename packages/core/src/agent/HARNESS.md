# AX Harness 설계 원칙

AX Studio Harness는 Aside류 **실행 Agent**가 아니라 **워크플로우 설계 Agent**입니다.

## Artifact boundary

- Agent → Workflow IR 설계·수정·판단 제안
- Runtime → Trigger·Connector·Approval 실행

## Prompt budget

1. **Small constitution** — `AGENTS.md`는 불변 규칙만 (역할·상태는 동적 주입)
2. **Dynamic capability surface** — workflow authoring agent에는 패키징된 runtime catalog 전체와
   연결 상태를 함께 보여 주고, investigate/runtime에는 연결된 read capability만 보여 줌
3. **Minimal state** — 필요한 draft·revision·completeness만 주입; chat은 summary + 최근 N턴
4. **Code enforces policy** — approval/sideEffect는 validator·runtime; prompt는 중복 설명 최소화

## Roles

| Role | Purpose |
|------|---------|
| `command` | command protocol로 workflow를 조회·작성·수정 |
| `investigate` | runtime evidence 기반 read 제안 |

## Model layer

Harness 아래 `ModelProvider`만 교체합니다. Command 실행과 결과 적용은 app/core가 orchestration하고, provider는 구조화된 command 또는 답변만 반환합니다. 역할별 provider 상한은 `command=8`, `investigate=1`입니다.
