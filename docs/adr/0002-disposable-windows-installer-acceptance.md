# Windows installer acceptance runs only in disposable hosted runners

Status: **Accepted by independent review for source implementation and tests on
2026-10-02. Installer dispatch and merge remain gated by parent code review.**
This is retrospective documentation, not prior approval. The initial harness was
already published in PR #154 at `28637a82812e02c8c9849fc77e75d2f6ca737d83`.
The subsequent preview build/verification, Unicode paths and second-uninstall
changes were already written locally when the ADR-first instruction arrived;
they were unpublished and unvalidated at the review checkpoint. The review now
permits completing the corrective implementation and source tests. This is not
evidence of successful hosted Windows execution or prior approval of earlier code.

Windows CI builds NSIS but checks unpacked payloads and test startup seams. That
does not establish real installed startup, migration, credentials or removal
retention. The pinned preview's packaging command also omits the Core build and
calls an Electron verifier without an explicit Chromium sandbox. We need evidence
from immutable preview-origin data without testing installation on a user's PC,
altering existing installations/security settings, using real accounts/API keys,
waiving failures or assuming the known output/log/IPC/UI regression is resolved.

The accepted decision is a manual-only, separate hosted Windows acceptance job,
with fresh job-owned paths, explicit runner/account/marker/path guards, verified
asset identity and ownership-checked NSIS operations. Keep real startup, DPAPI,
file dialogs and the installed PDF worker. Build the exact preview Core first;
assert its SQL adapter, Store and ArtifactStore outputs exist. Then orchestrate
preview packaging outside its unchanged product sources: use the old helper only
in its Python-only bundle/verify-bundle modes, retain archive/license/PDF checks,
and run a new explicit `chromiumSandbox: true` startup without fake flags. Never
call the old pack:win/verify-package chain. Verify the pinned tracked sources
remain unchanged before and after packaging.

Viable alternatives are to leave the workflow inactive and retain only unpacked
smoke (safe, but the installation question stays unanswered); adapt a copied old
verifier with reviewed transformations (preserves old checks but adds rewriting
and module-resolution risks); or introduce a shared version-aware package
verifier (reduces duplication but broadens this change across packaging formats).
The separate orchestration keeps producer provenance and confines compatibility
logic to acceptance tooling. Its cost is duplicate notice/archive/startup checks,
which can drift; regressions cover current packaging's nested `_electron` launcher,
the new preview launcher and the installed launchers. All require explicit
Chromium sandboxing. Packaging may retain labeled synthetic smoke; it is not
counted as genuine installed startup. Installed acceptance must have no fake seams.

Use Korean characters and spaces in owned install/data paths and synthetic PDF
and migration filenames. This is expected to expose quoting, NSIS directory,
native-dialog and worker path failures; it does not prove them before a runner
execution. Retention asserts the full file inventory, sizes and SHA256 values
under `AX_DATA_ROOT` only. Selected legacy DB, chat, credential and saved-file
checks establish specific persistence behavior. No complete Electron-profile,
home or temp inventory preservation is asserted. Use a fresh snapshot and
comparison around the final uninstall too, because recovery adds new source data
and cannot meaningfully reuse the first snapshot.

Correctness invariants and validation targets are: exact preview SHA/version and
unchanged tracked producer sources; all three Core outputs present before
packaging/fixture import; no route to the legacy Electron verifier; every reachable
launch explicitly sandboxed with no bypass switches, and genuine installed
acceptance free of fake seams; exact asset
and payload metadata/hashes; raw output/tails plus Store, IPC and rendered values
preserved; and byte-identical owned app-data snapshots across each uninstall.
Wrong ownership, path, profile, missing prerequisite, timeout or failed check
must yield failure without broader cleanup or a pass. Required source contracts
must have zero failures and zero new skips. The published revision passed 13
contracts. Two added workflow regressions first demonstrated the preview defects;
the corrective source revision then passed 20 release contracts with zero failures
and skips, syntax checks and a blocked local dry-run. Hosted Windows execution,
full product checks and actual NSIS/dialog/worker Unicode behavior remain unverified.

The reviewed network decision withholds real keys/connections and forbids
provider/mail/external data-write operations. Deny unexpected renderer HTTP(S)
at the available Playwright boundary without replacing agents or acceptance IPC.
Main-process SDKs, Python and earlier traffic remain outside that boundary; do
not claim process-wide isolation or zero outbound packets. No new OS firewall
or security settings are authorized. If stronger isolation is essential before
execution, obtain explicit approval of a reviewed network policy first. The
current compatibility failure remains a blocker; this ADR does not waive it.

Rollout requires completion of source regressions and required checks after the
accepted ADR review, then separate approval of the public diff before
any manual installer dispatch. Accept Windows support evidence only when both
clean lifecycle and preview upgrade pass every required stage with matching
source/asset records. On violation, keep dispatch off and preserve failure
evidence; dispose only the owned runner. Rollback reverts the acceptance commits
or disables further manual execution, without modifying installations/profiles
on a user's PC, expanding deletion, or weakening OS sandbox/ownership guards.
