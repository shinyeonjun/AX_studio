# Editable Slack result smoke contracts

This follow-up addresses PR #160's deterministic product-smoke failures at public
head `d4cd792ca016779faa553e7322d8a6663fce7390`. The preserved CI run is
[37038157173](https://github.com/shinyeonjun/AX_studio/actions/runs/37038157173).
Its required `verify` job passed the earlier checks but failed two scenarios that
still expected the generic inline approval card. The selected, implemented Slack
editor replaces that card for a final, editable one-action message send.

The unchanged baseline reproduced both missing-card failures in isolated Windows
profiles. A separate UI click on `게시 전 확인` confirmed the host's
`tool_result_identity_unverified` gate: the old deterministic connector lacked a
connected identity, a destination review adapter and a Slack `ts` receipt. Merely
changing the selector would leave the confirmation journey untested.

## Scope and isolation

Only the existing E2E chat seam, product-QA harness/scenarios and documentation
change. Production editor, preload, IPC handlers, runtime approval/seal checks,
connector implementations, dependency locks, security settings and launchers keep
their published bytes. No behavior change or ADR is proposed.

The existing host gate requires an unpackaged app with `AX_E2E=1` and
`AX_E2E_FAKE_AGENT=1`; the exact synthetic instruction selects this fixture.
The seam installs an in-memory Slack replacement and marks the connection in the
fresh internal fixture store. It uses no token, OAuth grant, SDK or network request.
These fixed identities are synthetic:

| Field | Value |
| --- | --- |
| Workspace | `T12345678`, E2E synthetic workspace |
| Sender | `U12345678`, E2E synthetic bot |
| Original destination | `#e2e` → `C12345678` |
| Manual override destination | `#e2e-edited` → `C87654321` |
| Synthetic receipt | `100.001` |

Unknown destinations fail verification. The adapter provides identity/destination
review through the real host contract; the host still owns revisions, seals,
literal dispatch, one-time approval claiming and result publication. Every fixture
connector invocation adds `e2e_slack_send` to the existing execution log before
validation. A 250 ms synthetic completion interval permits repeated pointer input.
There is no renderer-controlled dispatch counter or new observation IPC.

The harness opens the isolated internal SQLite file with `readOnly: true`, which
also respects native SQLite WAL. The observer requires deterministic mode,
`AX_PRODUCT_QA_ISOLATED=1` and a data path beneath that run's `data` directory.
It reads only execution/approval evidence and never opens an external database.

## UI journeys and assertions

`one-shot-inline-approval` keeps its existing scenario ID and now uses the named
Slack result region, labeled fields and actual review/back/confirm buttons. It
asserts complete autofilled values and zero connector calls; verified workspace,
sender, destination ID/label and full message; back navigation and review removal;
literal channel/message overrides; confirmation invalidation after another edit;
fresh review and zero calls; then two real pointer clicks on explicit confirmation.
Exactly one connector call must contain the complete approved payload, with
`literalMessage=true`. The receipt and terminal view must appear with no send or
cancel controls; a delayed observation must still show one call.

`one-shot-inline-approval-reject` reviews the full known destination/message, then
double-clicks the real cancellation button. It checks the actual `실행 취소`
status, rejected approval, cancelled execution with `approval_rejected`, absent
send/review/cancel controls and zero connector calls immediately and after a delay.
Both journeys leave the composer usable.
Capture readiness also requires the completed synthetic assistant reply, so
transient reply placeholders are not treated as finished screenshots. Review and
back actions assert the corresponding keyboard focus targets.

The original `clickInlineApproval` helper and present/absent checks remain intact.
Two additional legacy scenarios use a workflow with a false conditional
continuation, which naturally lies outside the final-action editor contract.
Generic approval must dispatch the original payload once; generic rejection must
dispatch nothing. The conditional's synthetic send must never execute. This keeps
legacy coverage through the actual card and runtime.

Desktop fixture unit tests exercise real runtime generic-approval rejection for
editable results, verified manual overrides, simultaneous confirmation attempts,
unknown destinations, rejection and both legacy decisions. Existing packaged/flag
gate tests remain unchanged. New typed scenario actions are reusable additions;
existing action/check semantics retain their definitions.

## Reproduction and evidence boundary

Use fresh synthetic profiles and an environment without provider credentials or
live configuration. The review executor also blocked external Node transports.
No live mode or shared-data option was used.

```sh
npm run build
npm run test:product-qa -- --mode deterministic --tier smoke --strict --isolated-data --skip-build
npm run test:product-qa -- --mode deterministic --tier smoke --strict --isolated-data --skip-build --repeat 2 --scenario one-shot-inline-approval --scenario one-shot-inline-approval-reject --scenario one-shot-legacy-approval --scenario one-shot-legacy-approval-reject
```

The existing Electron launcher sets `chromiumSandbox: true` and checks for
`no-sandbox`, `disable-setuid-sandbox` and `disable-namespace-sandbox`. This patch
adds no launcher or bypass. Slack captures use a 1280 × 873 CSS viewport and CSS
screenshot scale, matching the preserved CI failure viewport independently of
Windows display scaling. Selected design references and their earlier inspection
remain documented in [design QA](design-qa.md).

Playwright's complete report is authoritative. The harness aggregate report is
supplementary because a failed worker can reset its accumulated results. Curated
review evidence excludes profiles, databases, credentials, traces and executables.
It includes immutable patch/head/tree identities, exact check results, complete
synthetic observations and inspected captures.

Fresh coverage is limited to synthetic Slack and generic approval host roundtrips.
It does not certify Gmail delivery, Slack threads/files, external DB behavior,
ordinary-language provider planning, packaging or installation. The existing c837
packaging safety block remains in force. The published CI run remains red until
a separately reviewed patch is published and its ordinary CI completes.
