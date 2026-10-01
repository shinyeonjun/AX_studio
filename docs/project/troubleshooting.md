# AX Studio 트러블슈팅

실제로 발견한 문제와 검증 범위를 기록합니다. 합성 입력으로 재현한 사실, 정적 코드 감사에서 찾은 경계, 설치 검증의 공백을 구분합니다. 수정 완료는 관련 회귀와 통합 검증을 확인한 뒤 판정합니다.

## T01 원본 행 누락과 잘못된 완전성 표시

**상태:** 재현됨. 별도 patch의 구현·회귀 완료. 통합과 제품 출력 인수 미완료. 최초 확인 2026-10-01

**현상과 영향:** Excel의 읽기 제한이 전체 데이터보다 작아도 `truncated=false`, `completeness=complete`로 반환됩니다. 전체 자료라고 믿고 합계를 내면 일부 행의 값만 결과에 포함됩니다. 21개 시트가 있는 워크북에서는 20개만 남아도 누락이 표시되지 않았습니다.

**재현:** 합성 XLSX에 데이터 행 3개 또는 8개를 만들고 `rowLimit=2`로 읽습니다. 반환 행은 2개지만 완전한 자료로 표시되고 `sum` 집계가 받아들여집니다. 시트 누락은 21개 시트 fixture로 확인했습니다.

**원인:** 읽기 제한 적용 뒤의 테이블 크기로 완전성을 판단하고, 원본 `!ref` 범위와 워크북 전체의 누락 여부를 충분히 전달하지 않았습니다.

**수정:** 원본 데이터 행 범위를 builder에 전달하고 빈 행·원본 위치를 보존합니다. 워크북 완전성에 빠진 행·시트를 반영하며 부분 자료의 전체 집계를 거부합니다.

**증거:** 새 회귀 파일에서 수정 전 9실패·3통과, 최초 수정 후 12/12 통과. 최종 관련 15개 파일 67/67, Core 전체 2,008통과·8skip, webhook security 3/3, Core build·타입·architecture·patch apply 검증 통과. 통합과 Desktop·보고서 E2E는 미검증입니다. 자세한 환경과 범위는 [V03](validation-release.md#검증-증거)에 기록합니다.

**관련 코드:** `contracts/artifacts/table-build.ts`, `workbook.ts`, `connectors/local-sheet/read/xlsx.ts`, `workflow/transform-expr/evaluator/table.ts`

## T02 계산용 정규화로 원본 값과 행 정체성 손실

**상태:** 재현됨. T01과 함께 별도 patch 구현·회귀 완료, 통합 미완료

**현상과 영향:** 문자열 `00123`이 계산 값 `123`으로 바뀌고 주변 공백도 제거됩니다. 별도 원본 값이나 물리적 행 식별자가 없으면 결과에서 원래 셀의 의미와 행을 복원하기 어렵습니다.

**원인:** 계산용 변환과 원본 보존을 같은 값에 맡기고, 행 ID를 원본 bytes·시트·위치와 연결하지 않았습니다.

**수정:** 기존 계산용 값은 호환성을 위해 유지하면서 `rawValues`와 원본 행·열 메타데이터를 추가합니다. 행 `key`는 원본 파일 내용과 시트·물리적 행에 연결합니다. 선택한 열을 투영할 때 원본 값도 같은 범위로 투영합니다.

**검증과 한계:** 빈 값·빈 행·중복 업무 ID·선택 투영·원본 변경 시 key 변화·물리적 위치에 대한 회귀를 포함합니다. SheetJS의 scalar 원본 보존이며 수식·표시 서식·오류 메타데이터·CSV는 범위 밖입니다. 원본 변경 시 과거 검토의 취급과 XLSX·PDF 출력까지의 출처 보존은 미완료입니다. 현재 reader 회귀 통과가 출력 전체의 검증을 뜻하지 않습니다.

## T03 Jev 요청 헤더의 ByteString 변환 오류

**상태:** 합성 입력으로 원인 재현, Windows 작업트리 수정과 focused 회귀 통과. 실제 인증·UI 미검증

**현상:** `Authorization: Bearer <key>`에서 키에 한글 문자가 있으면 Fetch 헤더를 만드는 과정에서 ByteString 변환에 실패합니다. 합성 한글 키의 첫 문자가 `Bearer ` 뒤 index 7에서 오류를 일으키는 것을 재현했습니다. 실제 사용자의 키 내용은 원인 검증에 사용하지 않았습니다.

**수정:** 키 원문을 자동 `trim`으로 바꾸지 않고 검증합니다. 저장·IPC·환경 로딩과 요청 헤더 단계에서 invalid 입력을 차단합니다. 잘못 저장된 값 때문에 앱 전체 시작이 중단되지 않도록 Jev 비활성화와 복구 안내를 추가했습니다. UI는 키 등록과 실제 인증 확인을 구분하는 변경을 포함합니다.

**증거:** Core 24/24, Desktop IPC·credential mock 4/4, Core 컴파일과 Desktop 타입 검사 통과. invalid 합성 키의 `fetch` 호출은 0회. Electron 화면과 실제 TypeSafe 인증 성공은 확인하지 않았습니다.

**관련 코드:** `intelligence/decision/jev.ts`, Desktop `ipc/ai-handlers/decision-plane.ts`, `ai/config-file/secrets.ts`, `startup/ready.ts`, `JevDecisionPlaneForm.tsx`

**사용자가 보는 완료 조건:** 오류 원인이 명확하게 표시되고, 등록 상태와 인증 상태가 혼동되지 않으며, 잘못된 키로 요청이 나가지 않아야 합니다. 실제 키를 로그·fixture·문서에 넣지 않습니다.

## T04 Workflow LLM 문안이 제어 입력으로 연결될 수 있음

**상태:** 정적 감사에서 경계 발견. 명시적 문안 계약과 바인딩 제한 구현 중

**현상과 영향:** `ai_decision`의 미선언 출력 또는 일반 문자열이 LLM `modelFields`로 전달되고 후속 단계에 바인딩될 수 있습니다. 문안을 만들던 출력이 실행 대상·분기·필터·승인 판단에 사용되면 문안 전용 원칙이 깨집니다.

**수정 방향:** 허용된 문안 출력만 명시적으로 선언하고, 콘텐츠 입력과 제어 입력의 바인딩을 구분합니다. 파일·메일 본문 같은 콘텐츠는 허용할 수 있지만 수신자·도구·권한·조건을 문안이 결정하지 않도록 합니다.

**완료 증거:** 제어 입력으로 연결되는 negative 회귀의 거부, 기존 표·보고서 흐름의 정상 동작, 구형 workflow 호환성 영향과 사용자 안내를 확인해야 합니다. 코드 감사만으로 안전성을 확정하지 않습니다.

**관련 코드:** `runtime/investigation/decision-outputs.ts`, `decision-loop.ts`

## T05 테스트 wrapper가 실행 전 파일 생성에서 중단

**상태:** Windows에서 `EPERM` 발생. 직접 실행한 focused 테스트와 wrapper 실패를 분리 기록

`npm test`는 core 테스트 전에 `scripts/embed-skills.mjs`로 생성 파일을 갱신합니다. 해당 쓰기가 실패하면 Vitest가 시작되기 전 중단될 수 있습니다. 이 경우 “테스트 실패”와 “테스트를 실행하지 못함”을 구분해야 합니다.

설치된 Vitest로 직접 실행한 focused 회귀는 T03의 검증 증거로 인정할 수 있지만, wrapper와 전체 suite가 정상이라고 기록할 수는 없습니다. 허용된 작업 폴더·파일 권한·생성 경로를 확인한 뒤 정상 wrapper를 다시 실행합니다. 권한 거부를 우회하거나 테스트 때문에 의존성을 무단 설치하지 않습니다.

Linux 원본 보강 작업에서도 기본 data root에 쓸 수 없어 다수의 테스트가 실패했고, 기본 약 2GB heap에서 타입 검사가 메모리 부족으로 중단됐습니다. 명시적인 쓰기 가능한 XDG data root·4 workers와 6GB heap으로 같은 소스를 재검증해 전체 Core와 타입 검사가 통과했습니다. 환경 수정으로 해결한 실패를 제품 결함 수정으로 세지 않습니다.

## T06 Linux 문서 엔진의 기존 PDF 테스트 실패

**상태:** 기존 기준 소스에서 발견. 배포 후보 검증 차단

프로젝트 전용 Python 환경의 unittest 53개에서 PDF overlay·NBSP 관련 4실패와 4오류가 보고됐습니다. 이 환경의 PyMuPDF는 1.28.2입니다. 현재 증거만으로 실패를 새 Linux 패키징 변경 때문이라고 단정하지 않습니다.

같은 의존성·fixture로 기준 소스와 수정 소스를 비교하고, traceback·출력 PDF·기준값을 남겨 원인을 좁힙니다. 의존성 버전 차이와 렌더링 동작을 확인합니다. 회귀를 삭제하거나 기대값을 낮춰 green 상태를 만들지 않습니다. 성공한 portable Python smoke와 이 전체 suite의 실패를 함께 표시합니다.

## T07 FigJam 연결선과 라벨 오류

**상태:** 2026-10-01 새 검토 영역의 구조·전체·close-up 화면 검증 완료. 구현 상태는 별도

**현상:** 새 그림에서 화면 밖으로 나가는 연결선, 겹친 영역 이름과 초기 미완료 증거 영역이 발견됐습니다.

**원인:** 도형을 section에 옮기거나 재배치한 뒤 생성된 connector가 이전 routing 좌표를 유지했습니다. floating endpoint가 page 좌표에 연결되면 section 기준 위치와 어긋납니다.

**수정과 검증:** 최종 도형 배치 뒤 새 연결선만 다시 만들고 중복 section 라벨을 제거했습니다. 측정한 bounds로 box 크기·위치를 조정하고 section-relative 경유점을 사용했습니다. 구조 검사에서 overflow 0건, 전체 export와 E1·E2·E3 close-up에서 넘침·겹침 없이 확인했습니다. 그림 label은 32px이며 loop·error lane을 분리했습니다.

**범위:** 기존 A–D 그림과 사용자 작성 노드는 유지했습니다. [확인한 검토 영역](https://www.figma.com/board/tGFYVQ1GJZaihDWes3P792?node-id=153-422). 다음 변경 때도 좌표 검사와 실제 화면 확인을 반복합니다.

## T08 패키지 생성과 설치 검증의 차이

Linux AppImage 생성과 별도 위치로 옮긴 Python worker smoke는 통과했습니다. 깨끗한 머신의 설치, 네이티브 FUSE 실행과 실제 앱 UI·결과 저장은 별도 검증입니다. 네이티브 파일 대화상자를 mock 처리한 Windows 테스트도 실제 대화상자 동작을 검증하지 않습니다.

후속 검증에서 패키지·추출 payload의 archive·notices·worker 검사는 `--skip-ui`로 통과했습니다. 별도 GUI 실행에서는 `--appimage-extract-and-run`으로 settings·new-chat 탐색과 실제 native PDF 첨부 후 source·문서 artifact 생성을 확인했습니다. 최종 ready-state와 재시작 확인은 아직 진행 중입니다. 이 결과를 네이티브 FUSE 또는 깨끗한 환경 설치 완료로 확대하지 않습니다.

## T09 의존성 audit 수치와 배포 차단

**상태:** npm과 번들 Python의 audit 신호 확인, 영향·수정·최종 재검증 미완료

npm 결과는 영향받는 **20 packages**이며 package severity 집계는 high 13·moderate 7입니다. 서로 다른 underlying advisory URL은 **25개**입니다. 20개를 독립 취약점 20건이라고 기록하지 않습니다.

번들 Python의 pypdf 5.9.0에는 **77 vulnerability records**가 보고됐습니다. 이 수치는 scanner record 집계이며 실제 도달 경로·중복·영향 범위·해결을 별도로 확인해야 합니다. 패키지 smoke가 통과해도 audit 신호가 해소되는 것은 아닙니다. 잠긴 의존성과 번들을 함께 수정·재생성·검증하고 결과를 릴리스 후보에 연결합니다.

## 새 문제를 남길 때

문제마다 재현 입력·환경·소스 버전, 사용자 영향, 원인 근거, 수정 범위, 회귀 결과, 남은 검증을 기록합니다. 날짜와 상태를 갱신하고 관련 요구사항과 릴리스 차단 여부를 연결합니다. 로그와 스크린샷에는 키·토큰·사용자 파일·개인 경로가 포함되지 않도록 확인합니다.
