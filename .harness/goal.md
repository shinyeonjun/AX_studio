# Goal

Status: ACTIVE

## User Request

인터뷰를 “AI가 질문을 고르는 루프”에서 “코드가 빈칸을 묻고, AI는 workflow.json만 설계·patch하는 편집기”로 바꾼다.
`ai.분석` 같은 새 노드 타입은 만들지 않는다. 기존 `ai_decision`과 catalog `actionRef`를 쓴다.

## Desired Outcome

- 매 턴 시작 때 사용 가능한 action 목록과 연결 리소스가 MCP tool list처럼 프롬프트에 보인다.
- AI는 graph(`plan`)와 값(`patch`)만 쓴다. 채팅 질문 문장과 `done`은 코드가 소유한다.
- 미완료면 첫 미충족 슬롯 질문을 보여준다. AI `nextQuestion`이 완료/스케줄 문구여도 덮어쓰지 않는다.
- `done`은 `completeness.deployable`과 같다. 완료 표식은 필수가 아니다.
- 일회성(`once`)은 trigger를 묻지 않고, plan에 trigger가 없으면 `manual`을 심는다.

## Success Criteria

- [x] 미완료 상태에서 AI가 “넘길 수 있습니다”/스케줄 질문을 내도 채팅은 첫 미충족 슬롯 질문이다.
- [x] deployable plan은 완료 표식 없이 `done=true`가 된다.
- [x] once plan이 trigger를 생략하면 `triggerType=manual`이 되고 시작 조건 질문을 하지 않는다.
- [x] 인터뷰 프롬프트는 연결된 capability 전체 목록을 보여 주고, patch 턴은 nextQuestion을 비우라고 지시한다.
- [x] frozen evaluator 필수 명령이 통과한다.

## Constraints

- 기존 작업 트리를 되돌리거나 unrelated user changes를 삭제하지 않는다.
- `ai.analysis` / `gmail.send` 같은 새 타입·별칭 카탈로그를 만들지 않는다. 기존 `ai_decision`, `gmail.message.send`를 유지한다.
- discovery 5회 retry는 파싱/구조 실패 안전장치로만 남긴다. 정상 플로우의 질문 루프로 쓰지 않는다.
- frozen evaluator는 정당한 무효 사유가 없는 한 변경하지 않는다.

## Non-Goals

- 새 connector, MCP 서버, 런타임 실행 경로 재작성.
- UI 재디자인, 노드 패널 편집 복구.
- 사용자 자연어를 코드가 직접 파싱해 슬롯에 넣는 것(patch는 계속 AI).
- action 구현체 자체 변경.

## Notes / Assumptions

- 이전 QA/완료표식 실험은 이력으로 유지한다. 이번 작업은 그 계약을 코드-소유 질문/`done=deployable`로 교체한다.
- 일회성 시점을 사용자가 명시하면(`N분 뒤`) plan이 `once`+`runAt`을 쓸 수 있다. 말하지 않으면 `manual`이다.
