# AX Studio

로컬에서 돌아가는 AI 업무 실행 앱입니다.  
자연어로 일을 맡기면 인터뷰로 Skill을 만들고, 백그라운드에서 실행합니다. 데이터와 토큰은 우리 서버가 아니라 **이 PC**에 둡니다.

> 연결한다. 말로 맡긴다. 일이 끝날 때까지 수행한다.

## 하는 일

- **대화**에서 업무를 지시하고, 빈칸만 인터뷰로 채웁니다.
- **업무**에서 맡은 Skill을 켜고 실행합니다.
- **승인**에서 Gmail 발송 같은 외부 부작용을 사람이 확인합니다.
- **활동**에서 실행 이력을 봅니다.

v1 커넥터: Gmail, Slack, 읽기 전용 RDB, 로컬 표, 보고서(HTML/DOCX/PDF).

## 저장소 구조

```text
packages/core     Skill IR, 인터뷰, 런타임, 커넥터
apps/desktop      Electron 트레이 앱 (React)
docs/plans        v1 범위 (고정)
docs/future.md    나중에 할 일
```

## 요구 사항

- Node.js 22 이상
- Windows 우선 (macOS/Linux도 Electron이 동작하면 개발 가능)

## 시작하기

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

`npm run dev`는 데스크톱 앱을 띄웁니다.

## 비밀값 — Git에 올리지 말 것

| 파일 | 역할 | Git |
|---|---|---|
| `.env` | 개발용 Gmail OAuth Client ID/Secret만 | ❌ `.env.example`만 |
| `ai.toml` | 활성 AI / 모델 | ❌ `.ai.toml.example`만. **API 키 금지** |
| `*.db` | 로컬 SQLite | ❌ |
| OS credential store | AI API 키, Gmail refresh token | PC마다 암호화 저장. Git/공유 대상 아님 |

**AI API 키(Cursor/OpenAI/Anthropic)는 `.env`에 넣지 않습니다.** 앱 설정에서 등록하면 OS credential store에만 저장됩니다. 릴리즈 후에도 사용자 키는 각 PC의 userData에 격리됩니다.

개발용 `.env`에는 **Gmail OAuth 클라이언트**(앱 빌드용)만 둡니다. 사용자 API 키와 섞이지 않습니다.

### Gmail (개발자 1회)

일반 사용자는 Cloud Console을 열 필요 없습니다. **개발자가 Desktop OAuth client를 한 번** 만들고 `.env`에 넣습니다.

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트 생성
2. Gmail API 사용 설정
3. OAuth 동의 화면: Testing + **Test users**에 본인 Gmail
4. 사용자 인증 정보 → OAuth 클라이언트 ID → **데스크톱 앱**
5. `.env`:

```env
GOOGLE_OAUTH_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=   # PKCE 사용 시 비워도 됨
```

앱을 재시작한 뒤 설정 → Gmail → **연결하기**.  
흐름: 시스템 브라우저 + PKCE + `127.0.0.1` 랜덤 포트 loopback.

## 스크립트

| 명령 | 설명 |
|---|---|
| `npm run dev` | 데스크톱 개발 실행 |
| `npm run build` | core + desktop 빌드 |
| `npm test` | core 단위 테스트 |
| `npm run eval` | core eval |

## 문서

- [v1 계획](docs/plans/ax-studio.md)
- [나중에](docs/future.md)
