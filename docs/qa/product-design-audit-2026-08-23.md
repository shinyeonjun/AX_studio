# AX Studio Product Design Audit

Date: 2026-08-23 (Asia/Seoul)

## Scope

- Desktop Electron UI at the current development build.
- Reviewed flows: first-run workspace, prompt composer, `/` command menu, `/once` mode, top navigation, settings hub, Slack settings, activity empty state, approvals empty state, and light/dark theme.
- Evidence: current-run screenshots plus source review. No production source was modified.
- Accessibility target: WCAG 2.2 AA intent, keyboard semantics, screen-reader relationships, contrast, and failure announcement quality.

## User goal and health summary

The user should be able to understand what AX Studio will do, choose one-time versus repeat work, connect sources, approve side effects, and recover when an integration or run fails.

| Area | Assessment | Summary |
| --- | --- | --- |
| Visual language | Good | Consistent lavender system, calm spacing, readable hierarchy, light/dark parity is promising. |
| First action | Needs work | The blank start screen relies on a subtle `/` hint and gives no concrete example or primary path. |
| Navigation | High risk | Approval/settings top tabs visually imply a main-page route, but the main content remains chat unless a secondary item is clicked. |
| State trust | High risk | Slack can display “연결됨 · Poll” while warning that Socket Mode is off; recovery is disabled until a token is re-entered. |
| Destructive/recovery UX | High risk | Work, chat, and individual activity deletion are immediate; state/IPC failures are not consistently surfaced. |
| Accessibility | Needs work | Slash-menu semantics are a strong start, but form labels, tab relationships, error announcements, contrast, and zoom/mobile behavior need follow-up. |

## Numbered flow review

1. **Start screen — 주의**: Visually clean, but the only instruction is “`/` 로 일회용 · 다회용 업무를 만들 수 있어요” under a large empty stage. New users must infer the interaction model.
2. **Prompt composer — 양호**: The input and send affordance are compact and familiar. The composer has useful ARIA relationships for slash commands.
3. **Slash menu — 양호/주의**: `/once` and `/workflow` are easy to scan and keyboard hints are visible. The copy exposes implementation language such as `workflow.json`.
4. **One-time mode — 양호**: The selected mode is visible as a status capsule, the placeholder becomes contextual, and the clear button is labelled.
5. **Approval navigation — 문제**: Selecting “승인” changes the sidebar panel, but the central surface remains the chat home. This looks like a broken route, not an intentional split view.
6. **Settings navigation — 문제**: Selecting “설정” first shows the chat surface plus a settings sidebar. The actual settings hub appears only after selecting “설정 홈”, creating a two-step route with no explanation.
7. **Settings hub — 양호/주의**: Connector categories and readiness badges are scannable. Status vocabulary is not fully consistent: “준비됨”, “연결됨”, “연결됨 · Poll”, “미연결”, and “준비 중” can describe different dimensions without a shared legend.
8. **Slack detail — 문제**: “연결됨 · Poll” sits beside “Socket Mode가 꺼져 있습니다” and a disabled “다시 연결” action. The user cannot tell whether scheduled/manual messaging works, whether real-time triggers are broken, or what exact action restores them.
9. **Activity empty state — 주의**: The empty state explains when records appear, but the default question “왜 오늘 안 했어?” assumes a missed daily task and remains actionable when there is no execution to explain.
10. **Theme — 양호**: Light and dark surfaces preserve the overall hierarchy. Responsive and 125–200% zoom behavior was not fully verified in this run.

## Findings

### P1 — Fix before treating the desktop UX as production-ready

#### PD-01. Top-level navigation does not own the main content route

**Evidence**: `apps/desktop/src/App.tsx:192-203` renders `ActivityPage` only for `activity`; all other tabs render `ChatMainPage`. `apps/desktop/src/components/chat/ChatMainPage.tsx:46-57` renders settings only when `settingsScreen` is already set. The current-run screenshots `08-approvals-empty.png` and `05-settings-home.png` show the mismatch.

**Impact**: Approval review and settings look selected while the user is still looking at the chat home. This weakens wayfinding and can make a user believe a click did not work.

**Recommendation**: Choose one information architecture and make the UI match it: either render dedicated main surfaces for Work/Approval/Activity/Settings, or demote the sidebar controls to local filters and remove tab semantics. Do not keep a global-looking tab selected while the central route is unrelated.

#### PD-02. Integration status is optimistic while capability is degraded

**Evidence**: `apps/desktop/src/components/settings/connectors/SlackConnectionForm.tsx:21-27` labels the state “연결됨 · Poll” while explaining that Socket Mode is off. Lines `107-114` disable “다시 연결” unless a new Bot Token is entered. The same status is surfaced in `SettingsHub.tsx:50-55`.

**Impact**: A user can reasonably believe Slack automation is healthy while real-time triggers are unavailable. This is a trust and operational-risk issue, not merely wording.

**Recommendation**: Split status into capability states such as `Connected — manual/polling`, `Action required — real-time triggers unavailable`, and `Connected — real-time`. State which triggers and actions work, show the last successful check, and provide an enabled recovery path or an explicit reason why credentials must be re-entered.

#### PD-03. Destructive deletion is immediate for user-created work and history

**Evidence**: `apps/desktop/src/components/layout/WorkspaceSidebar.tsx:256-272` and `377-385` call delete handlers directly. `apps/desktop/src/App.tsx:53-77` can delete a workflow when an interview session is deleted. Individual activity deletion at `apps/desktop/src/components/activity/ActivityPage.tsx:128-137` also has no confirmation; only “기록 모두 지우기” asks for confirmation at lines `50-60`.

**Impact**: A single icon click can delete a workflow, conversation, or execution record, with no visible impact summary, undo, or recovery. Workflow deletion is materially different from deleting a chat.

**Recommendation**: Add entity-specific confirmation with the exact name and consequences, provide undo/trash where feasible, and separate “delete conversation” from “delete saved work”. Keep approval and external-side-effect history protected from accidental bulk deletion.

#### PD-04. IPC/state failures can collapse into stale or empty UI

**Evidence**: `apps/desktop/src/hooks/useAppState.ts:7-17` calls `window.ax.getState()` without loading/error state or a catch path. App-level actions such as approve/reject/toggle in `apps/desktop/src/App.tsx:112-124` also have no local failure presentation. `ActivityPage.tsx:34-36` calls `explain()` without a catch path.

**Impact**: A connector failure, backend startup race, or IPC exception can look like “no saved work”, “no approvals”, or an unresponsive button. That is especially dangerous for an automation product.

**Recommendation**: Model `loading / ready / error / stale` explicitly, preserve the last known data on refresh failure, add retry, disable or busy-state action buttons during mutation, and announce failures in a visible and accessible status region.

### P2 — Fix in the next UX hardening pass

#### PD-05. First-run experience is too passive

**Evidence**: `apps/desktop/src/components/workspace/AxWorkspaceChat.tsx:293-300` contains only the welcome heading and a subtle slash hint. Screenshot `01-start.png` shows a large unused stage.

**Impact**: The core product model—describe a task, choose one-time/repeat, review, then activate—is not discoverable without prior knowledge.

**Recommendation**: Add two or three example prompts and explicit “일회 실행” / “반복 업무” entry points. Explain what is saved, what runs immediately, and when approval is required.

#### PD-06. Slash-menu copy leaks internal implementation concepts

**Evidence**: `apps/desktop/src/components/workspace/AxWorkspaceChat.tsx:36-46` says “workflow를 만든 뒤” and “workflow.json을 저장해”. Screenshot `03-slash-menu.png` shows the resulting menu.

**Impact**: Users must learn repository/file terminology before they understand the product value.

**Recommendation**: Use product language such as “한 번 실행할 업무” and “반복 실행할 업무”; reserve workflow/file details for an advanced disclosure or technical settings area.

#### PD-07. Empty activity question has a blame-oriented default and no data guard

**Evidence**: `apps/desktop/src/components/activity/ActivityPage.tsx:29` initializes “왜 오늘 안 했어?” and lines `84-106` keep the ask bar active even when there are no executions. Screenshot `07-activity-empty.png` shows the result.

**Impact**: The first impression is accusatory and the action has no obvious evidence to analyze.

**Recommendation**: Change the default to neutral language such as “실행이 멈췄거나 실패한 이유를 물어보세요”, disable or contextualize the action when empty, and link to creating the first saved work.

#### PD-08. Saved work and chat history are not clearly grouped

**Evidence**: `WorkspaceSidebar.tsx:241-245` labels the work empty state, while sessions are rendered separately at `361-389`; the current UI can show a generic session such as “ㅎㅇ” without an explicit “최근 대화” heading. Screenshot `01-start.png` exposes the ambiguity.

**Impact**: Users may not know which items are durable automations, temporary chats, or interview drafts.

**Recommendation**: Add visible groups such as “저장된 업무”, “최근 대화”, and “업무 초안”; keep the existing “업무” tag but make the taxonomy visible without relying on item type styling.

#### PD-09. Developer-facing guide placeholder is visible in the product

**Evidence**: `apps/desktop/src/components/settings/ConnectionGuide.tsx:19-22` renders `slack-guide.png` and `src/images/에 넣으면 여기에 표시됩니다` when the guide asset is missing. Screenshot `06-slack-settings.png` shows it.

**Impact**: This reads as unfinished and gives users no actionable setup help.

**Recommendation**: Ship the guide assets, or replace the placeholder with a production copy block containing the setup steps, required scopes, and a link to the relevant provider documentation.

#### PD-10. Form labels are not programmatically associated in several connector forms

**Evidence**: Slack labels at `SlackConnectionForm.tsx:86-104`, the API key label at `ai/AiBrandForm.tsx:127-141`, and the folder path label/input at `connectors/LocalFolderConnectionForm.tsx:113-116` do not consistently use `htmlFor`/`id`.

**Impact**: Screen readers and label-click behavior may not identify the intended input, especially when multiple token fields are present.

**Recommendation**: Give every field a stable `id`, pair the label with `htmlFor`, and add accessible descriptions for token retention, scopes, and read-only paths.

#### PD-11. Tab semantics are incomplete and mirror the routing problem

**Evidence**: `WorkspaceSidebar.tsx:197-238` uses `role="tablist"` and `role="tab"` with `aria-selected`, but the panel at `241` is not exposed as a related `tabpanel` with `aria-controls`/`aria-labelledby`.

**Impact**: Assistive technology users do not receive a reliable relationship between the selected tab and the content it controls; sighted users already see the related route mismatch.

**Recommendation**: If these are real tabs, implement complete tab/tabpanel relationships and keyboard behavior. If they are application navigation, use links or buttons with current-page semantics instead.

#### PD-12. Error messages are not announced as errors

**Evidence**: `AxWorkspaceChat.tsx:324` renders an error as a plain `<div>`. A repository search found `aria-live` only on the busy/progress row at line `309`, and no `role="alert"` in `apps/desktop/src`.

**Impact**: A failed run may be visually present but missed by screen-reader users and may not receive focus.

**Recommendation**: Use `role="alert"` or a deliberate `aria-live="assertive"` region for actionable failures, move focus or provide a focus link when appropriate, and include retry/context-preserving actions.

#### PD-13. Several secondary text tokens are below comfortable AA contrast

**Evidence**: `apps/desktop/src/components/workspace/ax-workspace.css:473-476` uses placeholder `#8e8ea0` (approximately 3.22:1 against white); lines `696-699` use slash-menu hint `#9ca4b8` (approximately 2.50:1). The light theme `--text-muted: #6b7289` against `#eef2fb` is approximately 4.26:1, borderline/below 4.5:1 for normal text.

**Impact**: Hints and placeholders are harder to read, and some empty-state text is small enough that the borderline token matters.

**Recommendation**: Raise contrast for informative hints, avoid relying on placeholder text for required instructions, and recheck at actual font sizes with an automated contrast tool.

#### PD-14. Responsive and zoom behavior is under-specified

**Evidence**: The workspace stylesheet has a narrow `@media (max-width: 640px)` block at `ax-workspace.css:865-885`; the sidebar remains `280px` at `styles/base.css:32`, and settings cards use `minmax(280px, 1fr)` at `styles/settings.css:56`.

**Impact**: At small windows or 125–200% OS zoom, the fixed sidebar plus settings grid may force clipping or awkward horizontal scrolling.

**Recommendation**: Test 1024px, 800px, 640px, and 200% zoom; define a compact navigation mode, preserve focus visibility, and ensure connector forms remain usable without horizontal scrolling.

#### PD-15. Connected identity is displayed without a privacy affordance

**Evidence**: `apps/desktop/src/components/settings/connectors/GmailConnectionForm.tsx:75` renders the connected email address directly.

**Impact**: This may be correct in a private desktop app, but account identity can appear in captures, screen shares, or support logs.

**Recommendation**: Decide explicitly whether the product needs the full address. If not, mask or truncate it, provide a clear “connected account” label, and ensure support/debug surfaces do not copy it unnecessarily.

#### PD-16. AI readiness vocabulary can contradict itself

**Evidence**: `apps/desktop/src/constants/ai-providers.ts:50-55` describes Ollama as “준비 중”, while `apps/desktop/src/components/settings/ai/AiHubCards.tsx:73-80` can render a `ready` status as “준비됨”. Screenshot `10-settings-hub.png` shows both phrases together.

**Impact**: Users cannot tell whether Ollama is supported, locally detected, or merely planned.

**Recommendation**: Separate product availability from local readiness: e.g. “지원 예정”, “설치됨 — 선택 가능”, “설치 필요”, and “사용 중”. Use one status model across AI and connectors.

## Strengths worth preserving

- Calm, consistent visual system with clear selected-state treatment in both themes.
- `/` menu has good grouping, visible keyboard guidance, and useful active-row styling.
- `/once` selection is an effective interaction pattern: visible mode, context-specific placeholder, status semantics, and a labelled clear action.
- Token fields use password inputs, and connector cards expose useful high-level status.
- Activity empty state explains where records come from; the wording and action guardrails need refinement rather than a full redesign.

## Evidence limits and verification gaps

- This was a visual + source review of the current desktop development build, not a full automated accessibility audit.
- Keyboard traversal, screen-reader output, small-window layout, 125–200% zoom, high-contrast mode, and reduced-motion behavior require a dedicated follow-up run.
- The connected Gmail account identifier was observed during review but no screenshot containing it was persisted or included in this artifact.
- The repository baseline remains: core tests/typecheck/eval and production build passed; desktop typecheck failed in `HttpConnectionForm.tsx:75` and `WebhookConnectionForm.tsx:70` due to `string[]` assigned where `string` is expected. This UI audit did not change that baseline.

## Recommended order

1. Fix the navigation contract (PD-01) and make the approval/settings routes explicit.
2. Correct integration capability status and recovery (PD-02), then add loading/error/retry semantics (PD-04).
3. Add deletion confirmation/undo and separate work from chat deletion (PD-03).
4. Remove developer placeholders and rewrite first-run/slash/activity copy (PD-05–PD-09).
5. Complete accessibility semantics and contrast pass (PD-10–PD-14), then run the dedicated keyboard/zoom/screen-reader verification.
6. Resolve account identity policy and unified readiness vocabulary (PD-15–PD-16).
