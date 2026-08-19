# Future (out of v1)

여기에 적는 것은 아이디어일 뿐, 현재 구현 범위가 아니다. `docs/plans/ax-studio.md`를 넓히지 않는다.

- Connector SDK / OpenAPI → capability 자동 등록
- MySQL / MSSQL 방언 (같은 SQL capability, 드라이버만)
- DB INSERT / UPDATE / DELETE + transaction policy
- Loop / Parallel / Wait / SubSkill / Retry 엔진
- Slack 채널 읽기, Outlook, Teams, Drive, Sheets API, Notion, Salesforce, Jira
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
