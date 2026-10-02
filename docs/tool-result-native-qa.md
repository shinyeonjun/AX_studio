# Native Electron tool-result QA

Recorded validation date: 2026-10-02. The historical native result is 18/18 checks:
one normal built main/preload startup check and seventeen mounted synthetic
renderer checks. Eleven native screenshots and eleven separate browser captures
were individually inspected. Later Core/metadata composition and this
documentation change did not receive a fresh native launch or screenshot.

## Runtime and normal startup

The declared dependency was Electron 44.5.1 with Chromium 152.0.7977.130. Its normal
dependency installer downloaded the official Windows x64 archive, whose SHA-256
matched the bundled checksum:

`9b382492dcfee91f8f9e92c91f7972550a1b95d2299cac72279dab33a600d7db`.

The repository-relative executable was `node_modules/electron/dist/electron.exe`,
with SHA-256:

`49b61a030a520fc36a4b8fa5cce53fb4e935a7bdbbe4b80e9222f598e49cc7fa`.

Ordinary Core/Desktop source builds compiled main, preload and renderer. The
launcher starts `apps/desktop/out/main/index.js` with the production preload and
hardened window, using unique ignored application-data and Electron-profile
directories. The real preload returned zero connections and zero works. No other
profile, credential, configuration or database was copied.

## Mounted cases and isolation

The tool cases render production App/styles in separate native BrowserWindows
using the typed renderer-only synthetic API. They have no provider IPC preload,
connector SDK, credential or real delivery path. Normal startup smoke therefore
does not establish end-to-end tool IPC or provider verification.

The seventeen shared browser/native cases cover editable drafts, read-only table
evidence, literal edits, missing essentials and initial writing, explicit review,
edit/context invalidation, keyboard back/focus, double-click protection,
cancellation, approval-page recovery, stale responses, unsupported fields,
unknown outcomes and responsive panes. Completion cases additionally cover
retained-editor receipts after publication/refresh failure, cache-empty warning
recovery including fixture reload and isolation of deferred warning reads. They
assert no resend action and no unintended review/confirmation/send on completed
views. `completion-cases.mjs` supplies the same assertions to both runners.

Each launcher requests `chromiumSandbox: true`, inspects actual process arguments
and rejects sandbox/security bypasses. Native fixture renderer processes report
`sandboxed: true`. Context isolation, disabled Node integration and web security
remain enabled. Permission requests, external navigation and new windows are
denied; requests outside the loopback static fixture are blocked. The environment
contains only OS essentials and explicit synthetic-test flags.

## Pixel and setup results

Gmail/Slack captures use 1487 × 1058; database captures use 1486 × 1059. Supporting
states cover confirmation, approval recovery, unknown outcome, sent/refresh
warning, retained-editor receipt, cache-empty host warning, 900-pixel Gmail and
600-pixel database. [Design QA](design-qa.md) records inspected state and capability
differences.

The captures retain AX typography/navigation and lavender panes. Plain text,
unavailable attachments/threads, unrecorded historical connection labels/SQL and
bounded row counts remain accurate contract limits. Reference sample business
data was not imported. No screenshot is used as application UI.

At Windows 150% scaling, odd window extents can round by one DIP. Standard
viewport resizing verifies exact renderer dimensions; unedited CSS-pixel PNGs
exclude OS chrome. Native fonts, spellchecking and scrollbars remain visible.
Narrow layouts use vertical scrolling.

Initial setup failed size assertions from rounding and caught blocked development
HMR reconnect requests. Static preview and exact renderer viewport handling fixed
the setup without a sandbox bypass or OS change. The final passing counts exclude
that earlier failed run. A separate static-markup control remains unable to run
the asynchronous mount effect; it is not included in 18/18.

## Validation boundaries and reproduction

Synthetic reload is not an application disk-restart test. Separate Core reopen
controls cover persisted receipts/warnings and no replay, while the complete
completed-chat UI/cache restart path remains uncertified. Live provider delivery,
full production tool IPC, native menus, OS dialogs, full window chrome and
packaging/installer QA remain untested.

No real Gmail/Slack send, external DB write, live model/provider call, new grant or
API key was used. No security or OS setting was changed. This scope is narrower
than full product or release acceptance.

After ordinary dependency installation and source builds, use:

```sh
node test/tool-result-ui/native-run.mjs
```

The runner writes ignored results, sandbox evidence and captures to
`test/tool-result-ui/runs/native-electron/`. See
[the fixture README](../test/tool-result-ui/README.md) and
[verification guide](tool-result-verification.md) for prerequisites and source/test
scope. A new run must be reported separately from these historical measurements.
