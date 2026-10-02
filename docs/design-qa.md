# Editable tool results: design QA

Recorded validation date: 2026-10-02. The results below describe isolated synthetic
renderer checks and pixel inspection. They are historical measurements, not fresh
browser/native runs of the current complete build. Later Core and metadata changes
received source/contract verification; see [the verification guide](tool-result-verification.md).
Fresh, narrower Slack host-roundtrip checks from the later smoke follow-up are
recorded separately below and in [the smoke fixture contracts](tool-result-smoke-fixtures.md).

## Passed within the recorded scope

| Check | Recorded result and scope |
| --- | --- |
| Browser fixture | 17/17 mounted checks using the production App/styles with synthetic API responses; Edge 154.0.4258.48. |
| Native fixture | 18/18: normal built main/preload startup plus the same seventeen mounted checks; Electron 44.5.1 / Chromium 152.0.7977.130. |
| Related Desktop unit/IPC coverage | 91/91 across eight files: controller 24, renderer 17, IPC 31, workflow actions 4, message actions 2, Discovery 6, app state 5 and coalesced refresh 2. Later regression coverage is reported separately. |
| Types and normal source build | Desktop/fixture types and ordinary main/preload/renderer build passed for the recorded renderer validation. |
| Pixel inspection | All three selected references and 22 final captures, eleven per runtime, were individually inspected as pixels. |

Coverage includes filled drafts, initial human writing with missing essentials,
literal overrides, explicit destination/payload review, edit/back/context/connection
invalidation, Escape and focus restoration, double-click protection, cancellation,
approval-page recovery, stale reads, blocked attachments/threads, terminal unknown
outcomes and responsive panes. The fixture can perform only synthetic dispatch.

Three mounted completion checks establish that a returned receipt stays visible
in a disabled editor after publication/refresh failure; a cache-empty completed
view obtains the host warning alongside its stored receipt without a send; and
deferred warning reads cannot contaminate another tool/execution. Completed views
offer no resend action.

Every launcher sets `chromiumSandbox: true` and rejects requested/actual security
or sandbox bypasses. Native fixture renderer processes report `sandboxed: true`;
context isolation, disabled Node integration and web security remain enabled.
Requests outside the loopback fixture are blocked.

## Reference comparison

The Gmail and Slack reference images are 1487 × 1058; the corrected database image
is 1486 × 1059. They were inspected before image-dependent implementation and
during final pixel inspection. Reference sample identities and business data were
not imported into production or reused as real integration data. Test content is
independently synthetic.

| Tool | Reference-sized capture | Inspection result |
| --- | --- | --- |
| Gmail | `gmail-draft-1487x1058.png` | Clear tool identity, unsent badge, filled editable recipient/subject/body, attachment limitation and explicit review action. |
| Slack | `slack-draft-1487x1058.png` | Existing Slack asset, unsent badge, filled channel/message, workspace verification notice and honest top-level-message scope. |
| Database | `db-read-1486x1059.png` | Read-only evidence, execution provenance, readable rows, NULL distinction, current-page count and collapsed details. |

The other eight captures per runtime cover confirmation, approval recovery,
unknown outcome, 900-pixel Gmail, 600-pixel database, sent/refresh warning,
retained-editor receipt and cache-empty host warning. Supporting standard captures
use 1488 × 1056; narrow captures use 900/600 × 1056.

The panes retain AX's navigation, typography, whitespace and pale lavender visual
language. Plain editable text replaces unsupported rich formatting. Account and
workspace identity are verified at review rather than invented earlier. Database
results use the existing generic indicator and explicitly disclose unrecorded
labels/SQL. Page rows do not imply global totals, sales aggregates or export.

Narrow panes preserve reachable actions and visible focus. Table bodies and stacked
panes scroll vertically; the Gmail action row can require scrolling. No page-level
horizontal overflow was found in these checks. Native fonts, spellchecking and
scrollbars differ from browser rendering.

Windows 150% display scaling can round odd native window extents by one DIP. The
runner records display scale and uses the standard viewport API to verify exact
renderer dimensions. PNGs use CSS pixel scale without cropping or editing. They
exclude OS/window chrome, which appears in the references. These are bounded
layout/accessibility checks rather than pixel-identical copies or a full native
menu/dialog comparison. Screenshots are evidence, never product UI.

## Control and setup limitations

A static-markup control records two passes and one remaining failure because
static SSR does not execute the asynchronous warning lookup. It is excluded from
mounted passing counts. Mounted checks verify the actual effect boundary. A
pane-only negative control retained current controller/API/fixtures but substituted
the older pane: the original fourteen checks passed and all three added completion
checks failed. This does not establish a full old-build comparison or disk restart.

The initial native setup run failed exact-size assertions from display rounding
and detected blocked development HMR requests. Static preview and exact renderer
viewport handling resolved setup; final assertions passed without changing OS or
security settings. These initial failures are not counted as passing results.

## Blocked, unsupported or uncertified

| Area | Boundary |
| --- | --- |
| Fresh visual/native certification | Earlier renderer results remain historical. The later Slack smoke follow-up below adds fresh Electron UI checks and captures; it does not recertify Gmail/DB layouts. |
| Complete production tool IPC | Earlier tool fixtures used synthetic renderer APIs. The later Slack smoke follows real main/preload/runtime approval and result publication with an in-memory connector. Other provider IPC and live delivery remain uncertified. |
| Restart | Synthetic fixture reload and Core database reopen checks do not certify the complete completed-chat UI/cache disk-restart journey. Manual edits/seals remain memory-only. |
| Live integrations | Real Gmail/Slack delivery, provider/model calls and external network database reads were not exercised. |
| Unsupported capabilities | Gmail attachments, Slack threads/files, exact SQL/friendly historical DB labels and export remain unmet where requested. |
| Legacy table provenance | Bounded command-chat tables without execution-owned source evidence remain unverified. |
| Native/release scope | OS menus/dialogs/full chrome and packaging/installer QA were not tested. |

No real send, external DB write or new credential/OAuth grant was used for these
checks. Broader model quality or ordinary-language activation is not established.

## Reproduction

[The fixture README](../test/tool-result-ui/README.md) describes normal browser and
native commands. Runners write ignored results, sandbox evidence and captures
under `test/tool-result-ui/runs/`, with native output in `native-electron/`.
Reproduction generates new evidence; it must not relabel these recorded
measurements as a fresh run. [Native QA](tool-result-native-qa.md) documents the
normal startup and isolation boundary in more detail.

## Later Slack smoke follow-up: 2026-10-02

The follow-up starts from public head
`d4cd792ca016779faa553e7322d8a6663fce7390`. It changes the deterministic test seam,
typed harness/scenarios and documentation. Production editor/styles, tool IPC,
runtime, connector implementations, security settings and launchers are unchanged.
The immutable local review artifact records its exact final head/tree, source
protection matrix and complete reports. It is local and awaits independent review;
the published required CI run 37038157173 remains failed.

| Check | Fresh result and scope |
| --- | --- |
| Strict full deterministic smoke | 22/22 Playwright tests, including the two updated Slack decisions and two retained generic legacy decisions. Generated batches are reported by the complete Playwright report and scenario evidence separately. |
| Repeated decision journeys | 13/13 Playwright tests: eight approval/cancellation journeys (four decisions twice) plus five existing harness regressions. |
| Main/preload/runtime roundtrip | Actual Slack draft update, host identity/destination review, opaque confirmation, synthetic connector dispatch, receipt and workspace result publication. No tool IPC handler is replaced. |
| Dispatch evidence | Zero fixture invocations before explicit confirmation; one exact literal overridden payload after repeated confirmation input; zero after repeated cancellation input. Generic legacy approval sends once and rejection sends nothing. |
| Keyboard accessibility | Confirmation receives focus after review, and back navigation restores review-button focus. Accessible region/field/button names drive the journey. |
| Pixel inspection | Five final Slack states: filled draft, reviewed override, sent receipt, reviewed cancellation and cancelled status, at 1280 × 873 CSS pixels with settled chat output. |
| Regression checks | Desktop 255 passed in 48 files; Core 2,383 passed, zero failed, 11 skipped in 476 files; Core/desktop/harness types, normal production build, existing security 8/8 and architecture passed. |

The initial local attempt used an incorrect cancellation label. Actual pixels and
runtime format confirmed `실행 취소`; the corrected assertion still requires the
rejected approval, `approval_rejected` execution, removed action controls and zero
sends. Failed attempt reports are preserved and are not counted as passes. Early
captures also contained a transient reply placeholder, so final scenarios wait
for the completed synthetic chat reply before capture.

Pixel inspection confirmed the existing pale lavender panels, Slack branding,
visible workspace/sender/destination and complete literal payload. The review pane
scrolls vertically at this CI viewport; footer actions are reachable through focus
and actual clicks. The terminal sent view contains the synthetic receipt and no
resend action. Cancellation removes the editor and returns to the existing context
pane with a cancelled chat result. This is narrow flow QA, not a new certification
of every responsive size or a pixel-exact comparison against all design references.

All runs use fresh isolated synthetic profiles, the existing
`chromiumSandbox: true` launcher and no-bypass assertions. No live send/provider,
external DB operation, credential/grant, canonical checkout, packaging or OS/security
change is involved. The c837 installer safety block remains in force. Gmail
attachments, Slack threads/files, historical DB labels/SQL and the earlier broader
live/native limitations above remain outside this follow-up.

## Combined main-history verification: 2026-10-02

The isolated integration combines reviewed main
`41cf05691e30677fda2148ef5b88e79f0fb957f3` and approved UI/smoke input
`e74eb60b58007ecfe3412b85d446fb3bf1ff408a`. Final checks ran on
`2c56816579f6cb327c3b2014ad49a71265118cfb`, tree
`ee695336231927b87b0b5aeeb498aaa329d6b8cf`; the final artifact proves the later
verification-only commit has identical code and tests.

| Area | Fresh combined result |
| --- | --- |
| Full smoke | Passed: 22/22 tests, 22/22 strict deterministic scenarios, no flaky/skipped/unexpected tests. |
| Repeated decisions | Passed: 13/13 tests; eight real approval/cancellation journeys plus five regressions. All twelve decisions across both runs retain exact payload/count evidence. |
| Pixels and interaction | Passed within scope: five settled 1280 by 873 CSS-pixel Slack captures, actual draft/review/back/edit/confirm/cancel controls, review invalidation and keyboard focus. |
| Core/Desktop composition | Passed: 2,540 Core tests with eleven existing skips, 310 Desktop tests and five new composition regressions; types/builds/security/architecture and offline 24 cases pass. |
| Gmail/DB and other responsive views | Historical only; this merge does not change renderer/style blobs and does not provide fresh certification of these layouts. |
| Live integrations and complete restart/release | Uncertified; no real send, provider/model budget, external database call, real profile or installer run. |
| Independent review and published CI | Pending for this combined candidate; no push, PR update or main merge. The c837 packaging block remains. |

Actual pixels retain the pale lavender language, tool branding, autofilled
destination, complete literal override and accurate unsent/synthetic-receipt states.
The reviewed pane scrolls vertically at this viewport, with footer controls reachable
by focus and actual clicks. Cancellation removes the editor and restores existing
context. The existing context-pane PDF label is pre-existing content, not a new
general product-purpose restriction.

The combined history fix preserves preview bytes while durably recording
cancellation; it introduces no renderer change or new architecture choice. The
failed-before evidence, exact source matrices and all final reports are documented
in [the integration contract](tool-result-history-integration.md). Existing sandbox
and no-bypass assertions remain. Faulted reviewer processes were left untouched
and did not block these isolated runs. All earlier limits above still apply.
