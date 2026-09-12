# AX Studio

<p align="center">
  <img src="apps/desktop/src/ui/images/AX_Studio.png" alt="AX Studio" width="560" />
</p>

<p align="center">
  <strong>연결된 자료와 원하는 결과를 바탕으로 반복 업무를 설계하고 실행하는 로컬 AI 자동화 앱</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Electron-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/Windows-first-0078D4?style=flat-square&logo=windows&logoColor=white" alt="Windows first" />
</p>

AX Studio는 자연어로 맡긴 일을 인터뷰를 통해 구체화하고, 실행 가능한 워크플로우로 만든 뒤 백그라운드에서 수행합니다. 데이터와 API 키는 별도 서비스가 아니라 사용자의 PC에 보관하며, 메일 발송처럼 외부에 영향을 주는 단계에는 사람의 승인을 둡니다.

> 연결한다. 말로 맡긴다. 일이 끝날 때까지 수행한다.

## 30초 사용 흐름

```text
자료·서비스 연결
      ↓
자연어로 업무 요청
      ↓
AI 인터뷰로 조건과 빈칸 확인
      ↓
워크플로우 캔버스에서 검토·수정
      ↓
실행 → 필요한 단계 승인 → 결과와 활동 기록 확인
```

예를 들어 “Gmail 새 메일을 요약해 Slack으로 알려줘”라고 요청하면, AX Studio는 사용할 계정과 채널, 실행 조건을 확인하고 워크플로우를 구성합니다. 사용자는 생성된 흐름을 검토한 뒤 업무로 등록할 수 있습니다.

## 현재 구현 상태

> **공개 Preview:** Windows x64용 [v0.1.0-preview.1](https://github.com/shinyeonjun/AX_studio/releases/tag/v0.1.0-preview.1)을 제공합니다. 정식 안정판이 아닌 사전 출시 버전입니다.

릴리즈의 `AX.Studio.Setup.0.1.0-preview.1.exe`로 설치할 수 있습니다. 설치본에는 PDF 처리용 Python과 한글 글꼴이 포함됩니다. AI 제공자 인증은 별도로 설정해야 합니다.

설치 파일은 미서명 상태이며 Windows 경고나 조직 정책으로 설치가 제한될 수 있습니다. 기존 사용자는 앱을 완전히 종료하고 데이터를 백업하세요. 설치·체크섬 확인과 알려진 한계는 [릴리즈 안내](https://github.com/shinyeonjun/AX_studio/releases/tag/v0.1.0-preview.1)를 확인하세요.

| 영역 | 현재 저장소에서 확인되는 범위 |
| --- | --- |
| 업무 설계 | 대화형 Work Discovery, 구조화된 Workflow IR, 시각적 워크플로우 캔버스 |
| 실행 | 저장된 업무 즉시 실행·활성화·스케줄 실행, 중복 수동 실행 방지, 실행 결과와 활동 이력 |
| 안전 | Gmail 발송 등 외부 부작용 전 승인, 개발/설치 데이터 격리, OS credential store 사용 |
| 연결 | Gmail, Slack, 읽기 전용 PostgreSQL/MySQL, 로컬 폴더·문서 |
| 데이터 | CSV/XLSX 읽기용 `local_sheet`, SQLite 기반 로컬 상태 저장 |
| 결과물 | HTML/DOCX/PDF 보고서 생성 경로, 계산 결과 표시·저장·재시작 복원 |
| 검증 | core·desktop 회귀, 정적 빌드, 실제 PDF·프로세스 종료 복구, 실제 엔진과 설치본 Electron QA |

## 제품 구조

```text
apps/desktop      Electron 트레이 앱과 React UI
packages/core     Workflow IR, canvas, runtime, connectors, Work Discovery
test              product QA와 manual connector checks
docs              Work Discovery 계획과 설계·연구 자료
```

Windows 런타임 데이터는 실행 방식에 따라 분리됩니다.

```text
%LOCALAPPDATA%\AXStudio\          설치본 (Preview 포함)
%LOCALAPPDATA%\AXStudio-dev\      npm run dev (Dev)

  data\ax-studio.db
  credentials\          OS 암호화 자격 증명
  config\ai.toml
  documents\            문서 ingest cache
  templates\            PDF→HTML 양식
  generated\reports|exports\
  cache\chromium|document-engine\
  logs\
```

`npm run dev`와 설치본은 데이터, 자격 증명, 싱글 인스턴스를 공유하지 않습니다.

## 개발 환경에서 실행하기

### 요구 사항

- Node.js 22 이상
- Windows 권장
- Gmail 연결을 개발할 경우 Google OAuth Client ID (필요하면 Client Secret도)

```bash
git clone https://github.com/shinyeonjun/AX_studio.git
cd AX_studio
npm install
cp .env.example .env
cp .ai.toml.example ai.toml
npm run build
npm test
npm run dev
```

`npm run dev`는 Electron 데스크톱 앱을 실행합니다. macOS와 Linux에서도 Electron 개발 실행은 가능할 수 있지만, 현재 제품 검증과 패키징의 우선 대상은 Windows입니다.

## 검증

```bash
npm test                 # core 단위 테스트
npm run build            # core + desktop 빌드
npm run typecheck:tests  # 제품 QA와 앱 API의 타입 일치 검사
npm run test:product-qa -- --mode deterministic --tier smoke
npm run arch:check       # core 의존성 경계 검사
npm run test:release     # 실제 HTTP·동시 승인·프로세스 강제 종료 복구
npm run verify:release   # 전체 회귀 + 실제 PDF + strict full Electron QA
npm run verify:release -- --package  # Windows 설치본 빌드·내용물 검증까지
```

제품 QA harness는 구현된 기능 카탈로그에서 smoke, core, full, soak 시나리오를 생성합니다. 실제 메일·Slack 발송은 기본 테스트에서 제외되며 명시적으로 `--allow-side-effects`를 지정해야 합니다.

릴리즈 검사 명령은 사용자 프로필과 분리된 데이터로 실행하고, 실패한 검사를 건너뛰지 않습니다. Python 문서 엔진 의존성이 필요합니다. 검증 범위와 별도 수동 출시 요건은 [릴리즈 검증 안내](test/release/README.md)를 참고하세요.

외부 전송 도중 앱이 종료되면 완료 여부를 단정하거나 자동 재전송하지 않습니다. 재시작 시 해당 실행을 실패로 복구하고 연결된 자동 업무를 중지합니다. 활동 기록에서 원인을 확인하고 외부 서비스의 처리 결과를 확인한 뒤 재개해야 합니다. 실행 중·승인 대기 기록은 삭제로 유실되지 않으며, 일회 예약이 완료되어 정의가 정리되어도 실행 결과는 보존됩니다.

저장한 업무는 사이드바의 **실행** 버튼으로 즉시 실행할 수 있습니다. 일정이나 외부 전송 승인 정책은 바뀌지 않습니다. 활동 화면의 계산 결과는 성공한 실행에만 표시되며 재시작해도 유지됩니다. 입력 열 변경·불완전한 자료·저장 한도를 넘는 결과는 성공으로 처리하지 않습니다.

## 비밀값과 로컬 데이터

| 위치 | 역할 | Git |
| --- | --- | --- |
| `.env` | 개발용 Gmail OAuth Client ID/Secret | 커밋 금지 — `.env.example`만 제공 |
| `ai.toml` | 활성 AI와 모델 설정 | 커밋 금지 — `.ai.toml.example`만 제공, API 키 금지 |
| `*.db` | 로컬 SQLite 데이터 | 커밋 금지 |
| OS credential store | AI API 키, Gmail refresh token, 가져온 OAuth 클라이언트 | PC별 암호화 저장, 공유 대상 아님 |

AI API 키는 `.env`에 넣지 않습니다. 앱 설정에서 등록한 키는 OS credential store에 저장합니다. 개발용 `.env`에는 Gmail OAuth 클라이언트 설정만 두며 사용자 API 키와 분리합니다. Client Secret은 Electron Main 프로세스에서만 읽고 연결 메타데이터·렌더러 상태·로그에는 저장하지 않습니다.

### Gmail 설정

기본 배포본에는 Google OAuth 클라이언트가 내장되어 있지 않습니다. 본인의 데스크톱 앱 클라이언트를 준비해 앱에서 가져올 수 있으며, 재빌드는 필요하지 않습니다.

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트 생성
2. Gmail API 사용 설정
3. OAuth 동의 화면을 Testing으로 설정하고 본인을 Test user로 추가
4. 사용자 인증 정보에서 데스크톱 앱 OAuth 클라이언트 생성
5. 클라이언트 JSON을 내려받아 앱의 설정 → Gmail → **OAuth 클라이언트 JSON 가져오기**에서 선택

가져온 설정은 OS 암호화 저장소에 보관합니다. 클라이언트를 교체하려면 Gmail을 먼저 연결 해제하세요. 저장된 설정이 손상되어도 앱은 열리며, 설정에서 다시 가져오거나 명시적으로 제거할 수 있습니다.

개발 환경에서는 다음 `.env` 설정도 사용할 수 있습니다. 앱에서 가져온 클라이언트가 있으면 그 설정을 우선합니다.

```env
GOOGLE_OAUTH_CLIENT_ID=xxxxx.apps.googleusercontent.com
# Google 콘솔에서 발급된 경우에만 설정
GOOGLE_OAUTH_CLIENT_SECRET=xxxxx
```

앱의 설정 → Gmail → **연결하기**에서 시스템 브라우저 기반 OAuth를 시작합니다. 이 흐름은 PKCE, `state` 검증, `127.0.0.1` 랜덤 포트 loopback을 사용합니다.

## 주요 스크립트

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 데스크톱 개발 실행 |
| `npm run build` | core와 desktop 빌드 |
| `npm run pack:win -w @ax-studio/desktop` | Windows 설치본 빌드 |
| `npm run pack:win:signed -w @ax-studio/desktop` | 선택 사항: 인증서/서비스가 있을 때 서명 빌드·검증 |
| `npm run eval` | core eval 실행 |
| `npm run test:product-qa` | Electron 제품 QA harness 실행 |
| `npm run knip` | 미사용 코드·의존성 검사 |

## 라이선스

AX Studio 자체 소스 코드는 [MIT 라이선스](LICENSE)로 제공됩니다.
포함된 외부 라이브러리는 각자의 라이선스를 따르며, 전체 설치본이 모두 MIT라는
뜻은 아닙니다. PDF 엔진은 pypdf·ReportLab·PDFium을 사용하며, 포함된 나눔고딕
글꼴은 SIL Open Font License 1.1을 따릅니다. [외부 소프트웨어 고지](THIRD_PARTY_NOTICES.md)와
[배포 시 확인 사항](docs/RELEASING.md)을 참고하세요.

## 문서

- [Work Discovery 마스터 플랜](docs/AX_STUDIO_WORK_DISCOVERY_MASTER_PLAN.md)
- [Work Discovery 전환 계획](docs/plans/work-discovery-transition.md)
- [Work Discovery 전환 연구](docs/research/work-discovery-transition.md)
- [제품 QA harness](test/product-qa/README.md)
- [수동 커넥터 검증](test/manual/README.md)
- [Windows 릴리즈 절차와 설치 안내](docs/RELEASING.md)
