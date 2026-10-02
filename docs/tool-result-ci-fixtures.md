# Approval-resume fixtures require verified host confirmation

The first ordinary CI run for the editable tool-result panes failed three Core
tests that resumed final one-shot Gmail/Slack approvals through the generic
approval API. A transparent local reproduction with the original source, fixtures
and assertions unchanged returned `tool_result_confirmation_required` in all
three cases. Each approval remained pending and no synthetic message was sent.

This is the reviewed confirmation boundary working as intended. The fixtures had
not supplied a persisted chat, connected synthetic identity, provider preparation,
host review or provider receipt. Adding an approval-shaped ID or expecting
generic resume to succeed cannot establish that authority.

## Why the legacy approval nodes do not change the result

The existing `workflow/control-flow.ts` skips top-level legacy `human_approval`
nodes during execution. External action execution owns the actual approval.
Branch-local explicit nodes retain their existing behavior. This control-flow
rule and `workflow/approval.ts` are unchanged from the public base.

Consequently the context and approval-node binding fixtures also reach final
one-shot message approvals, with no remaining or outer steps. Their stored
approval payloads have no explicit `human_approval` type. All three are correctly
classified as requiring tool-result review. The explicit-node exclusion in that
classifier is not a reason to bypass review for these fixtures.

## Fixture correction

| Fixture | Preserved behavior and added boundary checks |
| --- | --- |
| `runtime/engine/execution-lifecycle/contexts.test.ts` | Preserve the same generated-artifact sink and persisted session in fresh and approval-resumed contexts. Generic resume stays pending with one sink observation; verified review and its real host seal permit the second observation and a receipt; replay adds no observation. |
| `runtime/engine/output-binding/implicit-slack-binding.test.ts` | Preserve inference of the preceding AI conclusion into Slack text. Reject generic resume, verify the complete draft and workspace/channel, dispatch through the host seal with one synthetic receipt, then reject replay. |
| `runtime/engine/output-binding/approval-node-binding.test.ts` | Preserve inference across a legacy approval node. The original nonstandard `message` field stays in the frozen plan and appears in `blockedFields`; review rejects it before identity preparation or dispatch. A separate supported-payload variant retains the original success/message assertions through verified review, receipt and replay rejection. |

Paths in the table are relative to `packages/core/src`.

The Slack `message` alias is not an allowlisted delivery field. Inferring a
canonical `text` binding does not authorize silently removing that additional
intent. The negative variant explicitly checks the retained value, blocked
review, pending approval and zero preparation/dispatch calls. The supported
variant keeps the success and exact message assertions, rather than deleting
success coverage to hide the failure.

The simulated connector preparations assert the exact synthetic draft and return
fixed synthetic authenticated account/workspace/destination bindings. Only the
fixture connector supplies a synthetic receipt. `WorkflowRuntime`, review,
single-use seal, durable claim, receipt and replay checks remain the real code.
Mocks are local to the affected fixtures; global mock connector behavior is
unchanged.

No runtime, connector, UI, persistence, schema, workflow policy or security guard
changes are needed. [ADR 0004](adr/0004-tool-specific-editable-results.md) still
governs confirmation and strict supported-field behavior.

## Verification scope

The focused corrected files pass **5/5**, including the added supported variant.
Both Core production/test type checks and the existing eight security checks
pass. Full Core verification on the corrected fixtures and unchanged published
product source passes **2,383 tests, zero failures and 11 skips** across 476 files
(2,394 total). Skips are three Windows/POSIX path cases, seven live-provider cases
and one unavailable-Python integration case.

The standard prompt regeneration step produced a CRLF-only embedded-file diff on
this Windows checkout. Both artifacts and the failed final integrity assertion
were preserved; literal/physical newline normalization proves equality. The
published generated artifact was restored, then the complete Core suite and
source-integrity check passed. The proposed patch includes no generated prompt
change. These are local synthetic results, not a replacement for ordinary CI on
a subsequently approved and published head.

To reproduce the focused tests:

```sh
npm run test -w @ax-studio/core -- src/runtime/engine/execution-lifecycle/contexts.test.ts src/runtime/engine/output-binding/approval-node-binding.test.ts src/runtime/engine/output-binding/implicit-slack-binding.test.ts --configLoader native --maxWorkers 1
```

All local checks use synthetic providers, isolated fixture databases, no inherited
provider credentials and an external-network guard. No actual Gmail/Slack send,
external database write or live model call is part of this correction. The
original failed CI run remains preserved. Local passing results do not make an
unpublished patch's CI green, and do not add visual/live/installer certification.
