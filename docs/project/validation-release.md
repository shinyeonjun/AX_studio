# AX Studio 검증과 릴리스

현재 결과는 개발 검증입니다. 여러 환경의 통과 수치를 합쳐 제품 전체의 성공률로 해석하지 않습니다. 배포 후보는 같은 소스와 의존성으로 다시 검증하고, 설치·사용·라이선스 확인까지 완료해야 합니다.

## 검증 증거

2026-10-01에 확인한 기록입니다. Windows 결과는 별도 미커밋 작업트리의 보고이며 정확한 최종 tree hash가 이 문서에 확보되지 않았습니다. Linux와 원본 데이터 작업도 기준 커밋 4071ce0 위의 서로 다른 작업트리에서 진행했습니다. **통합 후보에 대한 단일 검증 결과는 아직 없습니다.**

| ID | 환경과 범위 | 확인된 결과 | 증명하지 않는 것 |
| --- | --- | --- | --- |
| V01 | Windows 전체 개발 QA 보고 | Core 1,992통과·10skip, Desktop 146통과. Product QA 62/62, 선언 기능 커버리지 19/57, Playwright 20건. 보고서 fixture 16/16 | 전체 57기능 인수, 실제 Jev 정확도, 실제 외부 API, 네이티브 파일 대화상자와 설치 검증 |
| V02 | Windows ByteString focused 회귀 | Core 24/24, Desktop IPC·credential mock 4/4, Core 컴파일·Desktop 타입 검사 통과. invalid 입력 fetch 0회 | 실제 인증 성공, Electron UI·startup runtime 검증, `npm test` wrapper 정상 실행 |
| V03 | Linux 원본 데이터 patch, Node 22.23.2 | 수정 전 9실패·3통과, 최종 focused 67/67·15파일. Core 2,008통과·8skip, webhook security 3/3. Core build·production/test 타입·architecture·diff·정확한 base apply 검사 통과 | Desktop tests/build·GUI, 문서 엔진·보고서 E2E, live provider, Knip, 패키징, 통합된 분류·검토·출력 |
| V04 | Linux 패키징 작업트리 | Build, Desktop typecheck 통과. Desktop 142/142, Core 1,990통과·8skip, eval 11, architecture check, packaging tests 8 통과 | Windows 새 작업트리와 동일 소스, 새 strict 흐름의 제품 완료, 깨끗한 머신 설치 |
| V05 | Linux 문서 엔진 | Python unittest 53개 중 4실패·4오류. Portable Python의 relocated worker·PDF rendering smoke 통과 | 전체 Python suite 통과. smoke가 기존 실패를 해소했다는 주장 |
| V06 | Linux 배포 파일·정적 검증 | glibc x64 AppImage 생성 성공. 패키지·추출 payload verifier에서 archive·notices·relocated PDF rendering·worker 검사 통과. 각각 `--skip-ui` 사용 | 해당 verifier의 GUI 검사, 네이티브 FUSE 실행, 깨끗한 머신 설치, ARM·musl·macOS 지원 |
| V07 | FigJam 새 검토 영역 | Bounds 검사 overflow 0. 전체 export와 E1·E2·E3 close-up에서 label·연결선·넘침 확인 | 코드 구현·실행·인수 완료, 그림 변경 이후 상태 |
| V08 | Linux AppImage GUI 부분 검증 | 독립 데이터 폴더의 `--appimage-extract-and-run`에서 settings·new-chat 탐색과 실제 native PDF 첨부 후 DB source·문서 artifact 생성 확인 | 최종 ready-state·재시작 복구 검증 완료, 네이티브 FUSE와 깨끗한 머신 설치 |
| V09 | 별도 Jev 예외 recipe 계약 | 초기 focused 44건과 추가 persisted-plan tamper·payload-cap 2건 통과 보고. 확장 타입·전체 Core 검증 진행 중 | Global routing 변경, 행 분류·검토·집계·출력 제품 완료, live Jev 품질 |

V01의 QA는 **수행한 검사**만 판정합니다. 19/57은 선언된 기능 카탈로그의 커버리지이며 33% 수준의 업무 정확도나 모델 성공률이 아닙니다. 보고서 fixture는 결정적 planner를 사용하므로 실제 Jev·LLM의 계획 생성 품질을 검증하지 않습니다. [QA 정의](https://github.com/shinyeonjun/AX_studio/blob/4071ce0e82515f41d6763fc3ae8ba341a33f6555/test/product-qa/README.md), [보고서 benchmark의 한계](https://github.com/shinyeonjun/AX_studio/blob/4071ce0e82515f41d6763fc3ae8ba341a33f6555/docs/evaluation/report-generation-e2e-v1.md)를 함께 확인합니다.

기준 커밋의 보고서 benchmark 문서는 15개 사례를 설명하고 V01은 작업트리의 16개 결과를 보고합니다. 재실행할 때 source·fixture·runner 버전과 사례 수를 같이 고정해야 합니다.

V03의 patch SHA-256은 `1c907094c6af2c0c7c182d29bebc5069603479f02d331b846750e7a3a83c1c27`입니다. 전체 Core는 쓰기 가능한 독립 XDG data root와 4 workers를 사용했고, 타입·build에는 6GB Node heap을 사용했습니다. 결과는 이 patch의 완료 증거이며 병렬 작업을 합친 후보의 증거는 아닙니다.

V06의 개발 AppImage는 약 311MiB이며 SHA-256은 `9055944200f401ac4e93b0f7b1dd2b0f754b6b75808189ba669cc124c73f4e27`입니다. 이 hash는 해당 작업트리의 artifact를 식별하며 통합·공개 릴리스 asset의 hash가 아닙니다. V08의 GUI 확인은 진행 중입니다.

## AX와 LLM agent RAG 비교

목표는 Jev가 도구·검색·다음 행동을 선택하는 구조가 실제 개인 업무에서 유리한지 검증하는 것입니다. RAG는 검색한 자료를 생성에 활용하는 방식이므로 판단 모델과 동일한 층의 대체재로 취급하지 않습니다. AX도 필요한 자료를 조회할 수 있으며, 검색 전략과 판단 방식을 구분해 비교합니다. **승자를 가정하지 않고 실패와 trade-off도 결과로 남깁니다.**

다음은 평가 설계안입니다. 실제 유료 실행, 사용할 계정·모델·자료·예산은 별도 확인이 필요합니다.

| 조건 | 비교할 구성 |
| --- | --- |
| A AX | Jev의 제한된 도구·검색·다음 행동 선택 + host 실행·검증 + 공통 LLM 최종 문안 |
| B LLM agent | LLM의 도구·검색·다음 행동 선택 + 같은 host 실행·검증 + 공통 LLM 최종 문안 |
| C 검색 증강 구성 | 검색·색인 전략을 명시한 LLM agent + 같은 host 실행·검증 + 공통 LLM 최종 문안. A·B도 필요한 동일 자료와 native 검색에 접근 가능 |

평가 조건을 고정합니다.

- 같은 요청·자료·도구 카탈로그·사용 권한·승인 기준·시간과 재시도 한도
- 같은 최종 문안 generator·모델 버전과 출력 계약, 정답 기준·독립 평가자
- 원본 공개 범위와 검색 가능한 자료 동일. 색인 구축·갱신 비용과 준비 시간 별도 기록
- 사무·분석·경영·개발 시나리오를 작은 세트부터 확장하고 학습용·조정용·holdout을 분리
- 쉬운 성공 사례와 불확실성·부분 자료·도구 오류·권한 부족·잘못된 후보 사례 포함
- paired 반복 실행, 실행 순서 분산, 모델·입력 규모·도구·context 버전과 개별 trace 고정

보고할 지표는 다음과 같습니다.

- **정확성:** 업무별 독립 기준값, 사실·출처 일치, 분류 오류, 잘못된 행동과 안전한 중단
- **완료:** 사용자 수정을 포함한 실제 완료율, clarification·검토 횟수, 실패 유형
- **시간:** 전체 wall-clock과 p50/p95, 검색·판단·도구·문안별 시간. 모델 호출 시간만으로 비교하지 않음
- **사용량:** Jev·판단 LLM·최종 문안 LLM의 input/output·호출·재시도 사용량을 각각 기록. 서로 다른 provider의 raw token 수를 곧바로 동등한 비용으로 해석하지 않음
- **비용:** 모델·도구·색인 비용과 재시도를 합친 실행별 실제 비용, 사용 시점의 가격과 통화
- **재현성:** 입력·규정·도구 응답·모델 버전·설정, 기준값과 실패 trace

현재 이 비교의 측정 결과는 없습니다. 결과가 좋으면 지원 범위와 수치에 맞춰 설명하고, 좋지 않으면 실패 원인·개선 방향·유지하거나 버릴 선택을 기록합니다. “RAG가 불필요하다”, “Jev가 더 정확하다” 같은 일반 결론을 첫 사례만으로 내리지 않습니다.

## 테스트 층과 완료 조건

| 층 | 필요한 증거 |
| --- | --- |
| 단위·계약 | 후보 allowlist, 타입·참조·순환, 원본 보존, partial 집계 거부, 문안 제어 바인딩 거부 |
| 결정 provider | 유효·무효 선택, 불확실성, 오류·시간 초과. mocked 결과와 live 결과를 구분 |
| 업무 replay | 입력·규정·저장된 결정·검토를 고정한 기준값, 누락·중복·합계·근거 검증 |
| Electron UI | 첨부·계획 검토·예외 검토·결과 표시·재시작 복구. 검사 assertion과 native dialog 여부 명시 |
| 패키지 | 번들 runtime·worker·native dependency·필수 리소스·notices, 호스트 Python 없이 작동 |
| 실제 설치 | 깨끗한 환경 설치·시작·파일 읽기·쓰기·업데이트·복구. OS별 증거 |
| 배포 | 소스·버전·의존성·artifact hash·테스트 기록·라이선스·사용 안내의 정합성 |

실제 모델 호출에는 비용과 데이터 전송이 있습니다. 기본 회귀는 합성 데이터와 mock을 사용하고, live 검증은 기존 권한과 허용 대상·예산을 확인한 뒤 수행합니다. 실메일·Slack 전송은 기본 검증에 포함하지 않습니다.

## 기준 소스에서 확인한 검증 명령

아래는 기준 커밋에 존재하는 명령이며, 이 문서 작성 중 모두 다시 실행했다는 뜻은 아닙니다. 패키징 변경의 신규 명령은 통합 후 해당 패키징 문서에서 확인합니다.

```bash
npm test
npm run test:desktop
npm run typecheck
npm run build
npm run eval
npm run arch:check
npm run knip
npm run test:document-engine
npm run test:product-qa -- --mode deterministic --tier smoke --strict
npm run test:report-e2e
node test/report-generation-e2e/verify-report.mjs
```

Node 기준은 저장소의 `engines`에 맞춘 **22.x**입니다. Python은 프로젝트 전용 환경에서 잠긴 의존성을 사용하고, 테스트할 interpreter와 패키지 버전을 기록합니다. 제품 QA는 `--strict`를 사용해야 check 실패가 실제 종료 실패로 반영됩니다.

## Git Flow와 승인 범위

2026-10-01 09:24 UTC에 개발 브랜치와 테스트 prerelease의 지속 운영을 승인했습니다. 전략의 역할은 다음과 같습니다. 브랜치 이름의 합의가 모든 브랜치가 이미 생성됐다는 뜻은 아닙니다.

- `main`: 안정 버전. 병합과 정식 릴리스는 제품 책임자 확인
- `develop`: 검증한 기능을 통합하는 개발 기준
- `feature/<subject>`: 목적별 구현과 focused 회귀. PR에서 소스·영향·증거 제공
- `test/<subject>`: 제품 책임자가 승인한 실험·검증 브랜치. 실험 조건과 결과를 기록하고 안정 기능과 구분
- `release/<version>`: 통합 후보의 버전·패키지·회귀·릴리스 노트 고정
- `hotfix/<subject>`: 안정 버전의 긴급 수정. 필요한 회귀와 main 승인 유지, develop에 수정 반영

기본 흐름은 feature → develop → release 검증 → 승인된 main입니다. 개발 브랜치와 테스트 prerelease 게시가 승인되어도 실패한 필수 게이트나 미해결 라이선스 문제를 생략하지 않습니다. 보안·자격 증명·유료 서비스·새 권한에 대한 승인 범위는 이 전략으로 확대되지 않습니다.

현재 [CI 설정](https://github.com/shinyeonjun/AX_studio/blob/4071ce0e82515f41d6763fc3ae8ba341a33f6555/.github/workflows/ci.yml)은 main 대상 PR·main push·수동 실행에 연결되어 있습니다. develop·release 브랜치를 운영하려면 해당 이벤트와 branch 보호·필수 check를 정합성 있게 조정하고 실제 실행을 확인해야 합니다. 로컬 통과를 CI 통과로 기록하지 않습니다.

## 릴리스 후보 체크리스트

### 소스와 품질

- [ ] 통합 후보 SHA와 작업트리 상태, 버전·lockfile 고정
- [ ] 릴리스에서 선언한 지원 범위의 R01–R13 인수 증거 확보
- [ ] Core·Desktop·Python·업무 replay·타입·빌드·architecture 필수 게이트 통과
- [ ] 기존 PDF·workflow 회귀와 구형 데이터 계약 호환성 확인
- [ ] npm audit의 영향받는 20 packages와 25개 distinct advisory URL 검토·조치 기록. Severity package 집계는 high 13·moderate 7
- [ ] 번들 Python audit의 pypdf 5.9.0 관련 77 vulnerability records 검토·해결·재검증
- [ ] Knip의 기존 unused Jev export 확인·해결
- [ ] 해당 후보의 CI 실행과 필수 check 확인

### 배포 파일과 사용 검증

- [ ] Linux runtime·리소스·native 모듈·worker 정적 및 runtime 검증
- [ ] Linux 깨끗한 환경의 실행·입출력·결과 저장과 재시작 확인
- [ ] 제품 책임자의 Windows 사용 테스트와 실제 파일 대화상자 확인
- [ ] 버전·OS·아키텍처·SHA256을 asset마다 기록
- [ ] 업그레이드·데이터 보존·이전 버전 복구 방식을 검증
- [ ] FigJam과 문서에 구현·제안·미검증을 정확히 표시

### 라이선스와 공개 범위

- [ ] 프로젝트 공개 라이선스 결정과 소스·패키지 notices 정합성 확인
- [ ] Python 배포판·runtime·PDF 엔진·폰트 등 포함 리소스의 배포 조건 확인
- [ ] PyMuPDF/MuPDF를 포함한 현재 구성의 배포 조건 검토 완료
- [ ] 외부 Jev 서비스의 현재 약관·데이터 경계·배포 용도 검토
- [ ] 키·토큰·개인 파일·개인 경로·불필요한 메타데이터가 소스와 asset에 없음
- [ ] 테스트 prerelease에 알려진 문제·미지원 환경·검증 범위·기준 소스 표시
- [ ] main 병합·정식 릴리스에는 제품 책임자의 해당 후보 승인 확보

기준 feature 커밋에는 루트 `LICENSE`가 없습니다. 더 최신의 다른 릴리스 자료에 라이선스 파일이 있어도 현재 feature 소스와 패키지의 정합성을 자동으로 보장하지 않습니다. 공개·배포 전에 해당 후보로 확인해야 합니다. 위 검토는 법률 해석이나 라이선스 적합성 완료를 의미하지 않습니다.

## 결함 수정과 복구

실패한 후보는 같은 버전의 정상 asset처럼 배포하지 않습니다. 원인·수정·새 SHA·새 hash·재검증을 연결합니다. 이미 게시한 테스트 prerelease에 문제가 있으면 결함과 영향 범위를 알리고 수정 후보를 구분합니다. 데이터 migration이 있는 경우 되돌리기 가능 여부를 먼저 확인하고, 파괴적 복구를 자동 수행하지 않습니다.
