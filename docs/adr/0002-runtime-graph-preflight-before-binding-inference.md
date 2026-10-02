# Validate the runtime graph before inferring workflow bindings

Status: accepted for the scoped runtime repair. Date: 2026-10-02.

This is retrospective documentation of code already written at
`980af2e530e56f8cf1dcc8916ddd87606a69bbd0`, based on
`3dd272aaeffc5feb42ab63ce8507357f3baae965`. It is not prior approval. Product code
remains at that checkpoint; the subsequent commits document the decision and review.

Independent ADR/source review accepted this scope on 2026-10-02, with the result
relayed by the parent. The reviewer role assessed this ADR, the supplied two-file
production diff, the existing graph validators, and `recordPreflightResult`, and
reported no correctness blocker. This was static review; it did not independently
rerun the author-reported tests below. Review of the complete test source and
aggregate CI at the published head remain required before merge. Compiler changes
and acyclic graph resource limits were not approved by this acceptance.

At the baseline, runtime execution infers bindings before validating contracts.
Schema parsing accepts an IF graph `root -> a -> b -> a`; inference recursively
follows its branches and throws a stack overflow before runtime can record a
contract failure. A synthetic in-memory regression reproduced this without
providers or actions, in a child process with a 30-second kill limit. The required
outcome is a recorded `failed` / `contract_validation_failed` result, including
validation issues and the existing observer lifecycle, with no provider or
connector calls. Valid workflows must retain inference before full contract
validation: an AI input contract can lack a binding that inference supplies.

Viable alternatives are:

- **No change:** preserves existing behavior, including the reproduced overflow.
- **Full contract validation before inference:** restores the previous ordering
  but rejects valid workflows whose required AI bindings are inferred.
- **Guard recursion inside inference:** could protect direct inference callers,
  but needs an error contract and caller handling, and still needs separate
  checks for duplicate IDs and dangling edges. This is a proposed alternative,
  not implemented here.
- **Graph preflight, inference, then full contract validation:** reuse the existing
  ID, control-flow edge, and indirect-cycle validators before recursion; route
  graph issues through the existing preflight result path.

The last alternative is the accepted runtime decision and the current implementation.
The graph phase checks duplicate IDs, dangling/self edges, IF cycles across all
nodes, and the existing approval target rules. It does not prematurely validate
contracts that inference may satisfy. Valid graphs still undergo inference and
the existing full contract checks before any workflow steps run. Reusing the
existing checks avoids a second definition of graph validity. The tradeoff is an
additional graph traversal for valid workflows; full validation repeats these
checks. Graph errors now take diagnostic precedence over unrelated contract errors;
those contract diagnostics are reached after the graph is repaired. Preflight is
for active execution: existing global-disabled and paused-workflow cancellation
checks still run first for schema-valid input, with their existing manual override.
The added cost has not been benchmarked, and the decision makes no performance claim.

The existing 200-step schema limit does not bound expanded traversal of a shared
acyclic graph: inference and other branch walks can still repeat work exponentially.
Cycle rejection does not establish a resource bound for every valid DAG. This is a
separate resource-limit risk, not the compiler cycle risk below; mitigation remains
proposed and requires another reviewed decision before implementation.

Correctness invariants are: every rejected graph returns the recorded contract
failure with actionable issues and zero provider/connector calls; valid linear
and nested acyclic workflows keep inferred AI and action bindings; invalid
contracts after inference still fail before any calls. Observers and persisted
execution records must agree with the returned result. Author-reported evidence is 13
focused tests passed, 2,204 core tests passed with 11 skipped, dependency guards
5/5 and webhook guards 3/3, core build and core/test/desktop type checks passed,
and zero architecture violations across 1,291 modules and 4,781 dependencies.
These are the author's measured results, distinct from the independent static review.

The compiler remains a known risk outside this patch: canvas graph validation
accepts the same indirect cycle, and `applyContractCompilation` and
`buildIRFromWorkflow` overflow despite earlier validation. A separate bounded
synthetic probe reproduced both. The relevant compiler files are unchanged from
`23fc744164f9476085fa6266b3d0279ddf5c85d1`. Extending graph preflight to compiler
or direct inference callers is proposed follow-up work requiring its own review;
it is not implemented or approved by this ADR.

Publish the screened source, tests, and accepted ADR as a draft PR against
`test/integration-followup-20261001` for complete source review and aggregate CI
at its exact head; the parent owns merge and canonical synchronization. Reject or
hold integration if any correctness invariant fails or valid inferred binding
behavior regresses. Rollback is a parent-controlled revert of the source patch;
it restores the known runtime overflow, so integration must remain held until a
reviewed replacement is available. No automatic merge or rollback is authorized
by this record.
