# AX Studio

<p align="center">
  <img src="apps/desktop/src/images/AX_Studio.png" alt="AX Studio" width="560" />
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

> **개발 단계:** Windows 우선의 v1을 개발 중입니다. 소스에서 빌드·실행할 수 있지만, 일반 사용자용 공개 릴리스는 아직 제공하지 않습니다.

| 영역 | 현재 저장소에서 확인되는 범위 |
| --- | --- |
| 업무 설계 | 대화형 Work Discovery, 구조화된 Workflow IR, 시각적 워크플로우 캔버스 |
| 실행 | 등록한 워크플로우 활성화, 스케줄 실행, 실행 결과와 활동 이력 |
| 안전 | Gmail 발송 등 외부 부작용 전 승인, 개발/설치 데이터 격리, OS credential store 사용 |
| 연결 | Gmail, Slack, 읽기 전용 PostgreSQL/MySQL, 로컬 폴더·문서 |
| 데이터 | CSV/XLSX 읽기용 `local_sheet`, SQLite 기반 로컬 상태 저장 |
| 결과물 | HTML/DOCX/PDF 보고서 생성 경로 |
| 검증 | core 단위 테스트, 정적 빌드, Electron 제품 QA harness |

## 제품 구조

```text
apps/desktop      Electron 트레이 앱과 React UI
packages/core     Workflow IR, canvas, runtime, connectors, Work Discovery
test              product QA와 manual connector checks
docs              Work Discovery 계획과 설계·연구 자료
```

Windows 런타임 데이터는 실행 방식에 따라 분리됩니다.

```text
%LOCALAPPDATA%\AXStudio\          설치본 (Stable)
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
- Gmail 연결을 개발할 경우 Google Desktop OAuth Client ID

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
npm run test:product-qa -- --mode deterministic --tier smoke
npm run arch:check       # core 의존성 경계 검사
```

제품 QA harness는 구현된 기능 카탈로그에서 smoke, core, full, soak 시나리오를 생성합니다. 실제 메일·Slack 발송은 기본 테스트에서 제외되며 명시적으로 `--allow-side-effects`를 지정해야 합니다.

## 비밀값과 로컬 데이터

| 위치 | 역할 | Git |
| --- | --- | --- |
| `.env` | 개발용 Gmail OAuth Client ID | 커밋 금지 — `.env.example`만 제공 |
| `ai.toml` | 활성 AI와 모델 설정 | 커밋 금지 — `.ai.toml.example`만 제공, API 키 금지 |
| `*.db` | 로컬 SQLite 데이터 | 커밋 금지 |
| OS credential store | AI API 키, Gmail refresh token | PC별 암호화 저장, 공유 대상 아님 |

AI API 키는 `.env`에 넣지 않습니다. 앱 설정에서 등록한 키는 OS credential store에 저장합니다. 개발용 `.env`에는 Gmail OAuth 클라이언트 ID만 두며 사용자 API 키와 분리합니다.

### Gmail 개발 설정

일반 사용자가 아니라 앱을 빌드하는 개발자가 한 번 준비하는 설정입니다.

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트 생성
2. Gmail API 사용 설정
3. OAuth 동의 화면을 Testing으로 설정하고 본인을 Test user로 추가
4. 사용자 인증 정보에서 데스크톱 앱 OAuth 클라이언트 생성
5. `.env`에 클라이언트 ID 설정

```env
GOOGLE_OAUTH_CLIENT_ID=xxxxx.apps.googleusercontent.com
```

앱의 설정 → Gmail → **연결하기**에서 시스템 브라우저 기반 OAuth를 시작합니다. 이 흐름은 PKCE, `state` 검증, `127.0.0.1` 랜덤 포트 loopback을 사용합니다.

## 주요 스크립트

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 데스크톱 개발 실행 |
| `npm run build` | core와 desktop 빌드 |
| `npm run pack:win -w @ax-studio/desktop` | Windows 설치본 빌드 |
| `npm run eval` | core eval 실행 |
| `npm run test:product-qa` | Electron 제품 QA harness 실행 |
| `npm run knip` | 미사용 코드·의존성 검사 |

## 문서

- [Work Discovery 마스터 플랜](docs/AX_STUDIO_WORK_DISCOVERY_MASTER_PLAN.md)
- [Work Discovery 전환 계획](docs/plans/work-discovery-transition.md)
- [Work Discovery 전환 연구](docs/research/work-discovery-transition.md)
- [제품 QA harness](test/product-qa/README.md)
- [수동 커넥터 검증](test/manual/README.md)
