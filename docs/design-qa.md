# Editable tool results: design QA

Recorded validation date: 2026-10-02. The results below describe isolated synthetic
renderer checks and pixel inspection. They are historical measurements, not fresh
browser/native runs of the current complete build. Later Core and metadata changes
received source/contract verification; see [the verification guide](tool-result-verification.md).

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
| Fresh visual/native certification | No new browser, Electron launch or screenshot was produced for the later Core/metadata composition or documentation-only changes. |
| Complete production tool IPC | Native startup checks real main/preload state; tool cases use a renderer-only synthetic API. Full provider IPC roundtrips remain uncertified. |
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
