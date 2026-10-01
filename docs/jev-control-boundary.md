# Workflow 판단과 문안 출력

Jev는 선언된 boolean 및 255개 이하의 string/number enum을 선택한다. 단일 enum은 호스트가 고정 적용한다. 실행·입력 검증·권한·승인은 코드가 소유한다. LLM은 한국어 문안 등 표시용 문자열만 작성한다.

## 문안 계약

```json
{
  "type": "ai_decision",
  "id": "brief",
  "goal": "검증된 표의 내용을 한국어로 요약한다",
  "investigation": false,
  "outputSchema": {
    "type": "object",
    "properties": {
      "notify": { "type": "boolean" },
      "summary": { "type": "string", "purpose": "prose" }
    },
    "required": ["notify", "summary"]
  }
}
```

`notify`는 Jev가, `summary`는 LLM이 생성한다. 호스트는 모델이 반환한 다른 필드를 버리고 선언된 문안의 문자열 타입과 필수 출력 존재를 검사한다. Jev 실패·미설정·불명확한 선택을 LLM 판단으로 대체하지 않는다.

## Binding 경계

문안은 호스트 catalog의 parameter에 `purpose: "prose"`가 있는 본문 입력에만 연결한다. `TextArtifact` 또는 UI의 `inputType: "text"`는 문안 사용 권한을 부여하지 않는다. 새 연결기의 파일 본문 등 콘텐츠 입력에는 연결기 작성자가 해당 용도를 검토해 명시해야 한다.

현재 문안 입력은 Gmail 제목·본문, Slack 메시지 본문, HTML 문서 제목·데이터, DOCX 문안 데이터, PDF 양식 값·제목이다. 양식 값은 문자열 문안의 배치만 허용하는 연결이다. 수치 계산과 표 데이터는 기존 deterministic 경로에서 생성한다. LLM 문안을 SQL·TransformExpr·검색·필터·파일 경로·수신자·채널·연결 ID·도구·승인 대상으로 사용할 수 없다. LLM은 HTML/DOCX 템플릿이나 실행할 raw HTML을 생성하지 않는다.

콘텐츠를 받은 action의 출력도 콘텐츠 출처를 유지한다. 후속 제어 입력으로 옮기면 검증이 실패한다. 호스트의 `document.html.render` 결과를 `document.pdf.generate.html`로 전달하는 표시용 문서 흐름은 허용한다. action이 실행 변수에 기록한 콘텐츠 출처는 승인 체크포인트에도 저장한다. 원래 workflow에 작성된 템플릿만 한 번 해석하고, binding으로 받은 문안 안의 `{{...}}`는 그대로 전달한다. 앞선 모델 문안은 다음 Jev 판단의 암묵적 근거에서 제외한다.

## 기존 workflow 변경 영향과 복구

- `outputSchema`가 없는 기존 AI 단계는 표시용 `conclusion` 하나로 한정해 지원한다. 예전 `reason`, `category`, `confidence`, 기타 임의 출력은 저장·binding 대상이 아니다.
- 명시적 schema에는 기본 `conclusion`을 추가하지 않는다. 알림 본문에 필요하면 `{ "type": "string", "purpose": "prose" }`로 선언하고 `required`에 넣는다.
- 기존 `{ "type": "string" }`의 자유 출력은 자동 변환하지 않는다. 문안이면 `purpose: "prose"`, 판단이면 boolean 또는 유한 enum으로 바꾸고 연결을 확인한 뒤 다시 실행한다. 목적이 모호한 number/array/object 출력도 차단한다.
- 전체 `result`, 미선언 필드, AI 문자열의 중첩 필드를 실행 입력에 참조할 수 없다. 필요한 단일 필드를 명시한다.
- 문안에서 파생된 action 결과를 제어에 사용하던 workflow는 원본 자료, 고정 대상 또는 별도의 Jev 판단으로 제어 입력을 연결해야 한다. 전체 action 출력에 보수적으로 출처를 적용하므로 호스트가 생성한 ID도 자동으로 제어 권한을 얻지 않는다.
- 신규 chat planner·scheduled job·canvas는 문안 용도를 보존한다. 저장 전 검증과 실행/승인 재개 경계에서 모두 검사한다.

이 정책은 workflow 내부의 필드·binding·실행 변수 경계다. 외부 시스템에 보낸 문안을 이후 별도 실행에서 다시 조회하는 영속적 출처 추적은 제공하지 않는다. 실제 Jev 인증이나 live API의 품질은 mock 회귀 테스트로 입증되지 않는다.

## 로컬 검증과 권한 범위

2026-10-01 환경의 D: 작업트리는 읽을 수 있지만 일반 프로세스가 생성 파일을 쓸 수 없다. `npm test`는 `embed-skills.mjs`의 `embedded.ts` 쓰기에서 EPERM으로 종료했다. 원본 ACL·sandbox를 변경하지 않고 허용된 C: 작업 공간에 소스 검증 사본을 만들어 기존 설치 의존성을 재사용했다.

검증 사본의 표준 npm 스크립트를 실행했다. Vite 기본 config bundler는 C: 상위 디렉터리 조회에서 접근 거부를 받으므로 설치된 Vitest의 `--configLoader runner`를 사용했다. 테스트 TEMP/TMP도 허용된 작업 공간에 지정했다. 의존성 설치와 실제 사용자 설정·키 읽기는 수행하지 않는다.

최종 명령·결과·검증 사본/원본 소스 해시는 별도 로컬 evidence JSON에 기록한다. 테스트 로그·DB·원본 스크린샷·임시 산출물은 공개 저장소 게시 대상이 아니다.
