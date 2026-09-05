# Report execution hardening

Goal: address reviewed reliability risks through bounded, verified patches.
Preserve existing changes, read-only sources, exact replay and frozen fixtures.
Evaluator: report/provider/runtime tests; Core regression/eval; Core/Desktop
typechecks; production build; architecture and whitespace checks.

## Implemented

- Timeout/abort causes survive the report boundary, with phase-specific guidance.
- Model logs record prompt chars, image count/bytes and duration, not payloads.
- Separate calculation and layout inference. Layout uses calculated outputs rather
  than raw sources; calculation failures still enter the bounded replay repair loop.
- Atomic session-scoped checkpoints and explicit resumeExecutionId. Fresh requests
  never reuse evidence. File/config/request changes invalidate a retry. Only failed
  checkpoints may resume. Cached model outputs are revalidated against their schema.
- Preserve inference substeps so a layout failure can reuse a completed calculation.
- Bind reviseReportPlan to its receiver; regression verifies receiver preservation.
- Validate calendar dates, support root-array HTTP and cap cumulative rows/bytes.
- Record capture period/times and explicitly unverified cross-source consistency.
- Index joins with existing equality semantics and reject excessive expansion.
- Persist queue job/execution correlation including preflight failure paths.
- Expose explicit resume through existing command/document capability contracts.

## Evidence

Baseline: timeout/abort regression 2 failed, 38 passed.
Focused report/provider/runtime/command checks: 22 files, 95 passed.
Real synthetic Codex CLI calculation and layout contracts both passed.
Final regression/build outcomes are recorded in experiments.tsv.
Core final regression: 347 files, 801 passed, 3 skipped. An additional planner
checkpoint test was then added and the planner suite passed 9/9. Eval 11/11,
Core/Desktop typechecks, production build, architecture and diff checks passed.
No hidden gold, user PDF, or actual API/DB was used by the provider smoke.

## Still outstanding

These capabilities are not represented as completed by this patch:
- Durable queued-job restart recovery and interrupted-running execution recovery.
- UI-to-connector cancellation.
- Historical DB snapshots, filtered/projection SQL, cursor pagination and proof of
  cross-source consistency; automatic clarification lifecycle for missing evidence.
- Semantic-vs-format replay diagnosis and automatic PDF continuation pages.

Exact replay, read-only constraints and template capacity checks remain enforced.
The actual September PDF end-to-end outcome is still unverified.
