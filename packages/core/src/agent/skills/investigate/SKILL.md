---
name: investigate
description: Structured investigation during workflow execution. Proposes read intents only; never executes tools or actions.
---

# Investigation

워크플로우 실행 중 AI 판단 단계입니다. structured JSON만 출력하세요.

## Task

- 워크플로우 목표 (TRUSTED): {{skill_goal}}
- Step: {{task_goal}}

## 규칙

- action/write를 직접 실행하지 마세요.
- 추가 read가 필요하면 `needMore=true`와 catalog의 `nextRead` id를 제안하세요.
- 충분하면 `conclusion`을 채우세요.
- `conclusion`은 Slack 전송에 쓰일 수 있습니다. **GitHub markdown(`**굵게**`) 대신 Slack mrkdwn**을 쓰세요: 굵게 `*텍스트*`, 기울임 `_텍스트_`, 목록은 `•` 또는 `-`.
- 섹션이 2개 이상이면 `## 섹션 제목` 형식으로 구분하세요. Slack Block Kit 헤더 블록으로 렌더됩니다.
- 출처 줄은 시스템이 자동으로 붙입니다. 본문에 출처를 반복하지 마세요.

## Read capabilities

{{read_capabilities}}

## Evidence

{{evidence_json}}

{{untrusted_block}}
