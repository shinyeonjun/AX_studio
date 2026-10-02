# AX Studio 진행과 위험

제품 목표는 연결 도구 기반 범용 개인 비서입니다. 현재 구현 초점은 첫 Excel·규정 PDF 사례를 위한 원본 데이터 신뢰성, Jev 전용 계약, 문안·제어 경계와 Linux 패키징입니다. 각각의 작업트리를 별도로 검증하며 통합 후보는 아직 인수되지 않았습니다. 이 기록은 2026-10-01 UTC 기준입니다.

## 기획부터 현재까지

| 단계 | 확인된 내용 | 근거와 시점 |
| --- | --- | --- |
| 초기 제품 방향 | 자연어 자료와 숫자 자료를 다루는 Excel·보고서 업무 우선, Gmail·Slack은 부가 범위 | 초기 대화 방향을 2026-10-01에 재구성. 정확한 최초 결정일 미확인 |
| 초기 구현 | 로컬 AI desktop와 자연어 workflow 설계의 저장소 이력 | 최초 커밋 [6482c79](https://github.com/shinyeonjun/AX_studio/commit/6482c79), Git 작성시각 2026-08-19. 이는 구현 이력이며 제품 승인일은 아님 |
| Work Discovery 설계 | 과거 결과물·근거·replay로 반복 업무를 도출해 기존 Runtime에 연결하는 계획 | [기존 마스터 플랜](https://github.com/shinyeonjun/AX_studio/blob/4071ce0e82515f41d6763fc3ae8ba341a33f6555/docs/AX_STUDIO_WORK_DISCOVERY_MASTER_PLAN.md), [세션 수명주기 ADR](https://github.com/shinyeonjun/AX_studio/blob/4071ce0e82515f41d6763fc3ae8ba341a33f6555/docs/adr/0001-work-discovery-session-lifecycle.md). 계획 전체의 완료를 뜻하지 않음 |
| Jev 모듈·병렬 계획 | 제한된 도구 후보와 typed 계획을 코드에서 검사하는 경로 개발 | [4071ce0](https://github.com/shinyeonjun/AX_studio/commit/4071ce0e82515f41d6763fc3ae8ba341a33f6555), 2026-09-30 커밋 |
| 제품 QA와 오류 수정 | Windows 테스트 보고, Jev 키 헤더 오류 재현·focused 수정 | 2026-10-01 검토. [V01·V02](validation-release.md#검증-증거), [T03](troubleshooting.md#t03-jev-요청-헤더의-bytestring-변환-오류) |
| 첫 strict 제품 흐름 | Excel·텍스트 규정 PDF → 예외 분류 → 사람 검토 → 정확한 집계 → XLSX·PDF. 기존 PDF 경로 보존 | 2026-10-01 09:16 UTC 승인. [D04](architecture-decisions.md#결정-기록) |
| 전체 lifecycle 문서화 | 기획·설계·개발·문제 해결·검증·릴리스 문서, 적절한 그림과 검토 자료 | 2026-10-01 승인. 현재 문서군 정리 |
| Git Flow 운영 | 개발 브랜치·테스트 prerelease 운영, main·정식 릴리스 별도 확인 | 2026-10-01 09:24 UTC 승인. [릴리스 절차](validation-release.md#git-flow와-승인-범위) |
| 제품 비전 명확화 | 여러 직업의 개인 업무 비서. Jev·LLM CLI·도구 연결 중심, 사용자가 RAG나 workflow를 설계할 필요 없는 경험 | 2026-10-01 후속 대화. Excel·PDF는 첫 사례이며 제품 한계가 아님 |
| 평가 방향 | AX와 LLM agent·RAG 방식의 정확도·시간·토큰·비용을 동일 조건에서 비교 | 2026-10-01 후속 대화. 우위 미검증, 유료 실행 승인 미확보 |
| 도구 지식 | 각 도구의 도메인 의미를 이해해 연결 정확도를 높임 | 2026-10-01 후속 요청. Registry 계약은 제안·구현 미완료 |

## 현재 작업 상태

| 작업 | 진행 | 다음 완료 조건 |
| --- | --- | --- |
| 원본 데이터와 완전성 | 별도 patch 완료. Focused 67/67, Core 2,008통과·8skip, build·타입·architecture 통과 | 통합과 Desktop·보고서 E2E. Scalar·좌표만 보강하며 출력까지 provenance 유지 확인 |
| Jev 전용 예외 처리 | 독립 `contracts.ts`, `candidate-plan.ts`의 focused 초기 44건·추가 2건 통과 보고. 전체 Core·타입 검증 진행 | Global routing·Runtime 연결, 행 분류·검토 기록·출력 인수. 개인 비서 공통 엔진과 구분 |
| Workflow 문안 경계 | LLM 문자열의 제어 바인딩 경계 발견, 제한 구현 중 | negative 회귀·기존 보고서 회귀·구형 workflow 영향 확인 |
| 키 오류 수정 | 합성 입력 focused 회귀 통과, 별도 Windows 작업트리에 반영 | 실제 UI·startup mock/runtime 범위와 통합 후보 확인 |
| Linux 패키징 | AppImage 생성, 정적·추출 payload·portable Python 검사 통과. GUI 탐색·native PDF 첨부와 artifact 생성 확인 | 최종 ready-state·재시작·깨끗한 환경 검증, Python suite 실패·dependency audit·license/notices 해결 |
| FigJam 아키텍처 | 새 검토 영역의 구조·전체·close-up 화면 확인 완료 | 다음 변경 시 같은 QA 반복. 구현·비전·제안 상태 유지 |
| 릴리스 | 운영 범위 승인, 기술·라이선스 게이트 미완료 | 통합 후보의 체크리스트 충족 후 테스트 prerelease |
| 개인 비서 확장 | 제품 비전·공통 엔진 방향 확정. 역할별 인수 시나리오 제안 | 실제 도구·문맥·행동별 지원 범위와 UX 증거 확보 |
| 비교 benchmark | 공정 비교 설계안 작성, 측정 미실행 | 평가 데이터·모델·검색 조건·예산 확정 후 실행 |
| 도구별 도메인 지식 | 요구 확정, registry 계약 제안 | Connector별 실제 의미·완전성·binding·권한·실패 사례를 근거로 검증 |
| 대규모 DB 조회 | 기존 `SELECT * LIMIT/OFFSET`·materialized report 경계 정적 감사. 서버측 typed query 제안 | Snapshot·source scope·완전성·SQL 의미 보존 계약과 실제 DB 인수. 100만·1,000만 행 검증 미실행 |

## 위험과 차단 요인

| ID | 위험 | 현재 취급 | 다음 조치와 담당 |
| --- | --- | --- | --- |
| K01 | partial 자료를 전체로 집계하거나 원본 행을 잃음 | 별도 patch 해결, 통합·출력 인수 차단은 유지 | 개발·검증 담당이 통합과 출력 전체 확인 |
| K02 | 제품 전체가 Jev 전용으로 보이는 과장 | 경로별 상태를 구분. 기존 PDF LLM 경계 유지 표시 | 개발·검증 담당이 문서·UI·FigJam 상태 일치 확인 |
| K03 | LLM 문안이 제어 결정으로 사용됨 | strict 흐름의 인수 차단 | 명시적 출력 계약·바인딩 제한과 negative 회귀 |
| K04 | 설치 파일 생성이 사용 가능성으로 오해됨 | OS별 실제 사용 증거 부족 | Linux 설치·실행은 개발·검증 담당, Windows 사용은 제품 책임자 |
| K05 | PDF 엔진 Python suite 4실패·4오류 | 배포 후보 검증 차단 | 기준·수정 소스를 같은 의존성으로 비교하고 원인 해결 |
| K06 | feature 소스·번들의 라이선스와 notices 미정합 | 공개 배포 차단 | 제품 책임자의 라이선스 선택과 개발·검증 담당의 의존성·번들 점검 |
| K07 | npm audit 20 affected packages·25 advisory URL, 번들 pypdf의 77 vulnerability records, 기존 Knip 항목 | 영향 검토·조치 미완료 | 개발·검증 담당이 도달 경로·runtime 영향·수정·번들 재생성·재검증 기록 |
| K08 | 분류·미해결 예외·금액 정책 미확정 | 구현 전 정책 검토 필요 | 제품 책임자와 [열린 정책](requirements.md#구현-전에-확정할-정책) 결정 |
| K09 | 여러 작업트리의 green 결과를 통합 완료로 오해 | 단일 후보 검증 없음 | 통합 SHA 고정 후 필수 전체 suite와 CI 재실행 |
| K10 | 새 Git Flow와 기존 main 중심 CI 불일치 | 개발 브랜치의 필수 check 확인 필요 | CI 이벤트·branch 보호 정책 조정, 실제 브랜치 실행 확인 |
| K11 | “모든 업무·한 번 연결”이 현재 제공 범위로 오해됨 | 목표와 현재 구현·검증 범위를 분리 | 도구·행동별 지원표와 인증·권한·실제 설정 UX 검증 |
| K12 | AX·LLM agent·RAG 비교의 조건 차이로 잘못된 결론 | 측정 결과 없음. 공정 비교 설계 단계 | 같은 자료·도구·권한·최종 generator·독립 기준으로 paired 비교 |
| K13 | 도구 이름·schema만으로 데이터 의미를 판단 | 도메인 지식 요구 확정, connector별 검증 미완료 | Grain·단위·날짜·상태·완전성·권한을 기록하고 사용자 정책과 분리 |
| K14 | 대규모 DB 전체 행 materialization·pagination의 일관성 공백 | 정적 감사와 개선 제안, 실제 대규모 검증 없음 | Host 검증 query IR·서버측 집계·snapshot와 제한 결과 계약. SQL null·coercion 의미 보존 |

성능과 제품 차별성도 검증이 남아 있습니다. 1–2초 반응, 모든 업무 자동화, 경쟁 제품보다 우수한 결과는 현재 근거로 주장하지 않습니다. 개인 문맥·LLM CLI 연결·범용 시나리오의 구현을 첫 보고서 인수로 대체하지 않습니다. 외부 모델 서비스 약관과 데이터 경계는 출시 전 최신 내용으로 검토해야 합니다.

## 다음 검토 순서

1. 원본 보강과 문안 경계를 확정하고 focused 회귀 결과·호환성 영향을 검토한다
2. 예외 처리의 입력·후보 계약을 검증하고 필요한 제품 정책을 결정한다
3. 분류·검토·집계·출력을 연결해 정상 완료와 안전한 중단을 인수한다
4. 통합 후보 SHA를 고정하고 전체 회귀·CI·Linux·Windows 사용 검증을 수행한다
5. license/notices·asset hash·알려진 한계·복구 안내를 확인하고 테스트 prerelease를 게시한다
6. 대표 업무의 품질·비용·시간과 사용 피드백을 검토한 뒤 main 병합·정식 릴리스를 요청한다
7. 같은 엔진의 업무·도구·개인 문맥 인수 범위를 넓히고 공정 비교로 유리한 점과 실패 원인을 검증한다

슬라이드는 2번 설계 검토와 5번 릴리스 후보 검토에서 결정과 증거를 요약하는 데 사용합니다. 현재 발표 자료가 이미 만들어졌거나 승인됐다는 뜻은 아닙니다.
