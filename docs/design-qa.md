# Editable tool results: design QA

Recorded on 2026-10-02. Fresh combined-source QA covers the synthetic Slack
approval flow through the existing Electron main/preload/runtime. Earlier Gmail,
Slack and database renderer checks remain historical and are identified below.
Screenshots are supporting evidence; the application renders real components.

## Fresh combined-source checks

| Area | Passed result and scope |
| --- | --- |
| Full deterministic smoke | 22/22 Playwright tests and complete scenario runs, strict checks, zero skipped/flaky/unexpected tests or defects. |
| Repeated decisions | 13/13 tests: eight approval/cancellation journeys plus five regressions. All twelve decisions across both runs reconcile exact synthetic payload/count evidence. |
| Host roundtrip | Actual draft update, connected synthetic identity and destination review, opaque host confirmation, one synthetic dispatch, receipt and workspace-result publication. No tool IPC handler is replaced. |
| Editing and safety | Filled draft, complete literal override, back navigation, confirmation invalidation after editing, repeat confirmation/cancellation input, no dispatch before confirmation and no dispatch after cancellation. |
| Keyboard | Accessible region/field/button names drive real actions. Review focuses confirmation; back navigation restores review-button focus. |
| Pixels | Five settled, unedited 1280 by 873 CSS-pixel Slack captures inspected individually as actual pixels: draft, reviewed override, synthetic receipt, reviewed cancellation and cancelled result. |

The pixels retain AX navigation, typography, clean whitespace, pale lavender
panels and the existing Slack asset. Draft and review stay visibly unsent; review
shows workspace, sender, exact destination and full literal content. Receipt view
shows synthetic completion evidence and no resend action. Cancellation removes
the editor and restores the existing context pane. Its existing PDF material label
is incidental context content and does not define the app's general purpose.

Review content scrolls vertically at this viewport; actual clicks and focus reach
the footer actions. These captures use the existing QA viewport, which differs
from the selected design-reference dimensions. They provide fresh narrow flow
evidence, without a new pixel-identical or all-responsive-layout claim.

All runs use fresh synthetic profiles without provider credentials. The existing
launcher requests `chromiumSandbox: true` and asserts no requested/actual sandbox
or security bypass. No real provider budget, send or external database operation
was used. [Verification](tool-result-verification.md) records full units, types,
builds, persistence/reopen evidence and publication gates.

## Historical renderer/reference inspection

All three selected tool-specific variants were inspected as actual pixels before
image-dependent implementation. Gmail and Slack references are 1487 by 1058;
the corrected database reference is 1486 by 1059. Independent synthetic identities
and business data were used for fixtures; reference samples were not imported
into production.

The earlier browser fixture passed 17 mounted checks, and native fixture passed
18 including normal built main/preload startup. Twenty-two final captures were
individually inspected, eleven per runtime. Gmail/Slack drafts used the reference
dimensions; DB read results used the corrected reference dimensions. Supporting
captures covered approval recovery, unknown outcome, retained receipt/warnings,
cache-empty warning recovery, 900-pixel Gmail and 600-pixel DB panes.

| Tool | Historical pixel result |
| --- | --- |
| Gmail | Clear identity and unsent badge, filled editable recipient/subject/body, honest attachment limitation and explicit review. |
| Slack | Existing branding, filled channel/message, workspace verification notice and accurate top-level-message scope. |
| Database | Read-only evidence and provenance, readable rows, NULL distinction, bounded current-page count and collapsed available details. |

Mounted checks covered initial human writing with missing essentials, literal edits,
context/connection/stale-response invalidation, Escape/focus, double-click protection,
approval-page recovery and completed receipt/warning behavior with no resend.
Narrow panes retained reachable actions and no page-level horizontal overflow;
the Gmail action row could require vertical scrolling. Native fonts, spellcheck
and scrollbars differ from browser rendering. Standard CSS-pixel captures exclude
OS chrome; viewport resizing handled Windows display rounding without cropping,
image editing, OS changes or bypasses. These are historical bounded checks.

## Blocked, unsupported or uncertified

| Area | Boundary |
| --- | --- |
| Fresh Gmail/DB and all responsive sizes | Historical renderer evidence only; final integration does not change renderer/style blobs or recertify these views. |
| Live integration quality | Real Gmail/Slack delivery, provider/model planning and external database reads were not exercised. External DB writes remain prohibited. |
| Complete restart UI | Core raw-byte two-reopen controls do not certify completed-chat UI/cache restart. Drafts and seals are memory-only and require fresh review. |
| Unsupported capabilities | Gmail attachments, Slack threads/files, unrecorded historical DB SQL/friendly labels and export remain unavailable. |
| Legacy DB provenance | Tables without execution-owned source evidence remain unverified; missing labels/SQL/totals are not invented. |
| Native/release scope | OS menus/dialogs/full chrome, real-profile migration, packaging and installer QA are untested. The existing packaging safety block remains. |
| Publication | Final combined independent review and fresh CI remain required. No push, PR update or release occurred. |

Initial setup failures and static-markup controls were excluded from historical
mounted passing counts. In particular, static rendering cannot verify asynchronous
warning lookup. The mounted effect checks establish that narrower boundary.

[The fixture README](../test/tool-result-ui/README.md) describes normal browser and
native reproduction; [native QA](tool-result-native-qa.md) describes startup and
isolation. A new run produces new evidence rather than refreshing these historical
measurements automatically. [UI contracts](tool-result-ui-contracts.md) record
extensibility, unsupported fields and authority boundaries.
