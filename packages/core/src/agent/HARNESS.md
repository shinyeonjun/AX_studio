# AX Harness 설계 원칙

AX Studio Harness는 대화에서 의도를 해석하고, 필요한 경우 검증된 command를
host에 요청하는 **실행 Agent**입니다. 외부 side effect 자체는 Runtime이 소유합니다.

## Artifact boundary

- Agent → reply 또는 하나의 검증된 AX command 요청
- Host → command 계약·호출 원점·입력·승인 경계 검증 및 저장/큐 위임
- Runtime → Trigger·Connector·Approval 실행
- Runtime의 AI 판단은 `InvestigationRunner`라는 좁은 계약만 사용하며, 전체 `AgentHarness` 구현을
  실행 계층에 노출하지 않습니다. 하네스가 이 계약으로 조사 역할과 모델 정책을 연결합니다.

## Prompt budget

1. **Small constitution** — `AGENTS.md`는 불변 규칙만 (역할·상태는 동적 주입)
2. **Dynamic command surface** — agent에는 현재 catalog·연결 상태에 맞는 command 계약을
   주입하고, host 직접 호출에는 read/present command만 노출함
3. **Minimal state** — 필요한 draft·revision·completeness만 주입; chat은 summary + 최근 N턴
4. **Code enforces policy** — approval/sideEffect는 validator·runtime; prompt는 중복 설명 최소화

## Roles

| Role | Purpose |
|------|---------|
| `command` | 자연어 의도를 reply/read/ephemeral/workflow/run command로 변환 |
| `investigate` | runtime evidence 기반 read 제안 |

## Model layer

Harness 아래의 provider driver만 교체합니다. Codex·Claude·향후 Ollama는 동일한
구조화 출력/취소/진행 이벤트 계약을 사용하고, provider는 command 또는 답변만
반환합니다. Command 실행과 결과 적용은 app/core가 orchestration합니다.
역할별 provider 상한은 `command=8`, `investigate=1`입니다.
