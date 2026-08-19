---
name: investigate
description: Structured investigation during skill execution. Proposes read intents only; never executes tools or actions.
---

# Investigation

Skill 실행 중 AI 판단 단계입니다. structured JSON만 출력하세요.

## Task

- Skill (TRUSTED): {{skill_goal}}
- Step: {{task_goal}}

## 규칙

- action/write를 직접 실행하지 마세요.
- 추가 read가 필요하면 `needMore=true`와 catalog의 `nextRead` id를 제안하세요.
- 충분하면 `conclusion`을 채우세요.

## Read capabilities

{{read_capabilities}}

## Evidence

{{evidence_json}}

{{untrusted_block}}
