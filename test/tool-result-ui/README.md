# Tool-result UI synthetic fixture

The fixture mounts the production AX App and styles with a typed synthetic API.
It can perform only synthetic sends and has no live provider, credential or
external database mutation capability. Native startup uses a fresh empty profile
rather than another user's AX data.

## Browser checks

After normal repository dependency installation and Core compilation, run:

```sh
npm run build -w @ax-studio/core
node test/tool-result-ui/run.mjs
```

The Windows runner uses installed Microsoft Edge. It rejects sandbox/security
bypass arguments, blocks requests outside its loopback fixture and writes ignored
results, sandbox evidence and PNGs under `test/tool-result-ui/runs/`. It is a real
mounted renderer, not static HTML or a screenshot used as the app.

Recorded browser validation passed 17/17 checks. Coverage includes filled
Gmail/Slack drafts, read-only DB provenance/rows, literal editing, initial writing
with missing essentials, exact destination/payload review, confirmation
invalidation, double-click protection, cancellation, unsupported fields,
navigation/context/connection changes, stale responses, approval-page recovery,
unknown outcomes, keyboard/focus behavior and responsive panes.

`completion-cases.mjs` adds three shared mounted cases: retained-editor receipt
display after publication/refresh failure, cache-empty host warning recovery
including fixture reload, and deferred warning isolation across tools/executions.
Completed views expose no resend action. Static markup cannot execute the
asynchronous warning lookup and does not establish this mounted boundary.

## Native Electron checks

Use the repository's declared Electron dependency and ordinary source build:

```sh
npm run build
node test/tool-result-ui/native-run.mjs
```

The launcher starts the normal built main/preload with unique application-data and
Electron-profile directories. The real-preload smoke expects empty connection and
work lists. Tool cases then mount the production App/styles in sandboxed native
BrowserWindows using the same renderer-only synthetic API; those windows have no
provider IPC preload.

Every launcher requests `chromiumSandbox: true`, checks actual/requested process
arguments for bypasses and retains context isolation, disabled Node integration
and web security. Native fixture renderer processes must report `sandboxed: true`.
Permission requests, external navigation/new windows and requests outside the
loopback static fixture are denied.

Recorded native validation passed 18/18: normal startup plus the same seventeen
mounted cases. Eleven captures per runtime were inspected, including exact
1487 × 1058 Gmail/Slack and 1486 × 1059 DB viewports, supporting states and
900/600-pixel responsive panes. Windows display scaling can round window extents;
the runner verifies exact renderer dimensions and saves unedited CSS-pixel PNGs
without OS chrome. Native output lives in `runs/native-electron/`.

## Scope and related checks

The recorded results are historical. Later Core/metadata integration and
documentation-only preparation did not receive a fresh browser/native run.
Reproduction creates a new measurement and must retain its actual source scope.
Synthetic reload is not a full application disk-restart test. Normal main/preload
startup is not complete tool IPC or live delivery. OS menus/dialogs/full chrome,
packaging/installer QA, attachments, Slack threads/files, exact historical SQL/DB
labels and export remain outside the validated capabilities.

Desktop's committed draft/controller/pane and approval IPC tests provide unit
coverage. From `apps/desktop`, a focused command is:

```sh
node ./node_modules/vitest/vitest.mjs run electron/main/ipc/runtime-handlers/approval.test.ts src/features/chat/ui/workspace/tool-result/draft-controller.test.ts src/features/chat/ui/workspace/tool-result/ToolResultPane.test.tsx src/features/chat/hooks/workspace-chat/workflow-actions.test.ts src/features/chat/hooks/workspace-chat/message-actions.test.ts src/features/chat/hooks/useDiscovery.test.ts src/app/hooks/useAppState.test.ts src/app/hooks/coalesced-refresh.test.ts --configLoader native --maxWorkers 2
```

From the root, `npm run typecheck -w @ax-studio/desktop` and
`npx --no-install tsc --noEmit -p test/tool-result-ui/tsconfig.json` check types;
the ordinary Desktop build compiles main/preload/renderer without launching or
packaging the app. [Verification](../../docs/tool-result-verification.md),
[design QA](../../docs/design-qa.md) and [native QA](../../docs/tool-result-native-qa.md)
record the test scopes and remaining limits. No live provider credentials or
actual Gmail/Slack sends are needed.
