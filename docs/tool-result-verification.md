# Editable tool-result verification

Recorded validation date: 2026-10-02. This guide records focused synthetic checks
performed before the documentation-only publication preparation. Production,
test, fixture, configuration and launcher content is unchanged by that
preparation. The measurements are not fresh executions of a later documentation
commit and do not certify repository-wide CI or live integration behavior.
The later approval-resume fixture correction and its separate local results are
recorded in [CI fixture verification](tool-result-ci-fixtures.md).

## Source and isolation

At published head `71f3c4f3b73e65d76d1da7e4683d09568001bff8`, the
non-documentation full-index binary patch relative to public base
`13446a568df671a18504386316d8f085c97def7c` has SHA-256:

`60439771c0c1ad6d2ccf908cc7e2823b98b12e5ccf2c1ab25eed79d0dd894219`.

Its definition excludes `docs/**` and the tool-fixture README. It can be reproduced
from the repository root with:

```sh
git diff --binary --full-index 13446a568df671a18504386316d8f085c97def7c 71f3c4f3b73e65d76d1da7e4683d09568001bff8 -- . ':(exclude)docs/**' ':(exclude)test/tool-result-ui/README.md'
```

All tests used synthetic connectors, scripted transports, fresh in-memory/local
fixture databases and isolated application data. No provider credentials or live
model/provider budget were inherited. Local database seeding is fixture setup;
external databases received no writes. Electron launchers retain
`chromiumSandbox: true` and requested/actual no-bypass checks.

## Recorded checks

| Check | Result | Scope |
| --- | --- | --- |
| Focused Core regression union | 877/877, 144 files | Approval, persistence/recovery, connectors, DB read-only/provenance, graph preflight, command output, metadata/transcript and four composition cases. |
| Focused Desktop regression union | 142/142, 14 files | Draft/controller/pane, trusted IPC, existing refresh/navigation and metadata HTTP cases. |
| Metadata HTTP contract | 13/13 | Original case assertions, scripted transport and forbidden-call requirements unchanged; included in Desktop total. |
| Request-understanding fixture/scorer | 24/24 | Original cases; zero forbidden calls and zero generated-model calls. |
| Supplemental metadata controls | 11/11 | Paired transcript/revision 5, operation association 4 and trusted IPC 2. |
| Supplemental producer/service controls | 4/4 | Actual hook with queued-state model and legacy registration association. |
| Supplemental tool-result controls | 5/5 | Bootstrap warning points, generic confirmation guard and verified command handoff. |
| Core disk-reopen controls | 2/2 | Gmail/Slack persisted receipt/warning, stale seal rejection and one synthetic send after reopen. |
| Types | Passed | Core production/test, Desktop and renderer fixture. |
| Normal builds | Passed | Core and Desktop main/preload/renderer; no packaging or installer. |
| Existing security checks | 8/8 | Dependency and webhook security regressions. |
| Architecture | Passed | 1,317 modules, 4,988 dependencies, zero violations. |

Supplemental controls are separate measurements and are not additional tests in
the 877/142 totals. There is no configured lint script. Diff-whitespace checking
is a separate source/documentation check.

## Critical regression contracts

| Area | Committed regression coverage |
| --- | --- |
| Editable drafts and trusted confirmation | `runtime/tool-result-approval.test.ts`, Desktop `draft-controller.test.ts`, `ToolResultPane.test.tsx` and IPC `approval.test.ts`: literal overrides, missing essentials, unsupported fields, strict requests, seal invalidation, stale review, concurrent confirmation and cancellation. |
| Durable claims and outcomes | `runtime/tool-result-durability.test.ts` and `tool-result-persistence-failure.test.ts`: persistence before dispatch/acknowledgement, receipt retention, deletion invalidation, unknown outcome and no replay. |
| Crash boundaries | `runtime/tool-result-recovery-ordering.test.ts`: twelve cases, six each on file-backed SQL.js/native SQLite, observing real last disk/WAL state without an added close/flush. Pending checkpoints, resolved sent/unknown states, cancellation and interrupted recovery stay reachable and do not resend. |
| Bootstrap warnings | `application/tool-result-refresh.test.ts`: provider success survives projection, workspace notification and observer failures with bounded warnings, exact literal payload, receipt, durable state and one send. |
| Command handoff | `commands/chat/command-loop.tool-result-handoff.test.ts`: verified persisted-session handoff succeeds after explicit review; the existing generic continuation test requires confirmation and sends zero times. |
| Metadata and tool-result composition | `application/tool-result-metadata-reconciliation.test.ts`: four Gmail/Slack cases with real fresh Core/store, manual literal edits, stale transcript/metadata writer rejection, one sealed dispatch, receipt persistence and session deletion after database reopen. |
| DB enforcement | `connectors/rdb/client/readonly.test.ts`, `persistence/db/readonly-adapters.test.ts`, RDB read-contract/connector suites: read-only setup failure, SQLite mutation/pragma/multiple-statement rejection and execution-owned result evidence. |

Core paths in this table are relative to `packages/core/src`; Desktop controller
and pane tests are under `src/features/chat/ui/workspace/tool-result`, and IPC
tests are under `electron/main/ipc/runtime-handlers`.

The metadata IPC fixture supplies a real inactive `WorkflowRuntime` over its real
store and drains it during cleanup. This satisfies the deletion handler's runtime
contract without optional production deletion or changed original case assertions.
An initial fixture lacked that runtime and failed one case; all thirteen original
assertions passed after fixture completion. An initial forced SQL.js test backend
bypassed two native migration controls; removing that environment override restored
the unchanged controls and the complete 877-test focused run. These setup failures
are excluded from final passing counts.

Core build prompt regeneration was checked for Markdown CRLF-only differences and
restored to the committed source. No semantic prompt content changed.

## Reproduction commands

Use normal repository dependency installation and synthetic fixture configuration.
Relevant existing root commands include:

```sh
npm run typecheck
npm run build
npm run arch:check
node scripts/verification/request-understanding-offline.mjs
```

The following focused commands cover the principal committed contracts; they do
not reproduce the entire 144/14-file regression union:

```sh
npm run test -w @ax-studio/core -- src/runtime/tool-result-approval.test.ts src/runtime/tool-result-durability.test.ts src/runtime/tool-result-persistence-failure.test.ts src/runtime/tool-result-recovery-ordering.test.ts src/application/tool-result-refresh.test.ts src/application/tool-result-metadata-reconciliation.test.ts src/intelligence/agent/commands/chat/command-loop.tool-result-handoff.test.ts src/connectors/message-send-review.test.ts src/connectors/rdb/client/readonly.test.ts src/persistence/db/readonly-adapters.test.ts --configLoader native --maxWorkers 1
npm run test -w @ax-studio/desktop -- electron/main/ipc/runtime-handlers/approval.test.ts electron/main/ipc/workspace-chat-command-handlers/metadata-turns.offline.test.ts src/features/chat/ui/workspace/tool-result/draft-controller.test.ts src/features/chat/ui/workspace/tool-result/ToolResultPane.test.tsx src/features/chat/hooks/workspace-chat/workflow-actions.test.ts --configLoader native --maxWorkers 1
```

Within `packages/core`, `npx --no-install tsc --noEmit -p tsconfig.test.json` checks
test types. From the root,
`npx --no-install tsc --noEmit -p test/tool-result-ui/tsconfig.json` checks fixture
types. [The fixture README](../test/tool-result-ui/README.md) covers mounted browser
and native QA.

## Visual and live boundaries

Recorded browser/native checks passed 17/17 and 18/18 with 22 inspected captures;
[design QA](design-qa.md) and [native QA](tool-result-native-qa.md) describe their
historical source scope. They are not fresh certification of the complete current
build. Normal builds and Core database reopen tests are narrower than the full
completed-chat UI/cache disk-restart journey or complete production tool IPC.

Gmail attachments, Slack thread/file posting, exact SQL/friendly historical DB
labels and export remain unsupported. Edits/seals are memory-only and restart
requires fresh review. Unknown outcomes never automatically resend. Legacy bounded
command-chat tables without source provenance remain unverified. Live delivery,
external network database reads, ordinary-language activation/model quality,
native menus/dialogs/full chrome and packaging/installer QA remain uncertified.
