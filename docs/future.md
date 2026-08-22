# Future (out of north star)

여기에 적는 것은 아이디어일 뿐, 현재 구현도 최종 목표(`docs/plans/ax-north-star.md`)도 아니다.

북스타로 **옮겨 간 것** (여기 다시 넣지 말 것): OpenAPI/MCP catalog 주입, Slack 읽기, HTTP REST, Webhook(localhost + 사용자 터널), 평챗에서 저장 업무 실행, 로컬 검색 인덱스.

- MySQL / MSSQL 방언 (같은 SQL capability, 드라이버만)
- DB INSERT / UPDATE / DELETE + transaction policy
- Loop / Parallel / Wait / SubSkill / Retry 엔진
- Outlook, Teams, Drive, Sheets API, Notion, Salesforce, Jira
- **기본 업무 노드 로드맵** — `packages/core/src/nodes/README.md` (Formatter, Storage, Webhook, PDF Read, Google Calendar/Sheets 등)
- Browser / Desktop RPA
- 웹 검색
- 회사 PDF 위 영역 지정
- 멀티유저, SSO, RBAC, 사내 서버 배포, Control Center, Skill marketplace
- n8n / MCP 상호운용
- 업무 로그 기반 AX Discovery
- llama.cpp / vLLM / 모델 자동 라우팅 세부
- Task를 별도 DB 엔티티로 승격
- Future Gateway credential models
  - A. Edge credential / local execution (Gateway orchestrates, Agent PC holds Gmail tokens)
  - B. Central credential / server execution (Gateway vault + web OAuth)
  - Decision deferred until Gateway requirement exists.
