# Release reliability gate

`npm run test:release` builds core and tests real loopback HTTP requests, durable SQLite state and child-process termination. All data is temporary; no AI, mail, Slack or customer profiles are used.

- Twenty concurrent approvals produce one outbound request and one durable receipt.
- Killing a process after an HTTP server receives a request, but before it replies, leaves a failed execution after restart. Both automatic and approved runs are covered; the associated automatic workflow is paused.
- A downstream failure stays failed. Repeated webhook delivery after restarting the host does not replay the preceding external effect.
- A CLI list command while a real HTTP execution is in flight does not recover or fail the execution owned by the running host. Core recovery is opt-in for the exclusive long-lived host; the desktop enables it at startup, not ordinary CLI/library consumers.

The suite deliberately uses the deferred-write sql.js backend. The Windows package gate separately checks native document dependencies and the real Electron application (which may use the supported sql.js fallback if native SQLite is unavailable). These tests establish conservative no-automatic-replay behavior, **not distributed exactly-once delivery**. If completion is uncertain, the user must inspect the external service before manually retrying.

## Complete local verification

```bash
npm run verify:release
npm run verify:release -- --package  # Windows only; builds installer and tests its unpacked payload
```

The gate stops at the first failed command. It includes core/desktop tests, type checks, document-engine tests, evals, dependency checks, these failure-injection tests, real PDF worker output verification and full strict deterministic Electron QA. Linux desktop QA requires a display (e.g. `xvfb-run --auto-servernum npm run verify:release`). Install `packages/document-engine/requirements-test.txt` into the Python environment on PATH before running the gate. If using the project venv, activate it first; PDF tests prefer that venv and support `AX_REPORT_E2E_PYTHON`.

Python dependency auditing uses `pip-audit` with strict collection. The ordinary gate audits the resolved document requirements; `--package` and Windows CI additionally audit the exact bundled `site-packages`, including transitive packages. The scanner is verification tooling and is not shipped. `pypdf` is pinned to 6.16.1 because the former `<6` range retained known malformed-PDF resource-exhaustion vulnerabilities; see the [upstream advisory](https://github.com/py-pdf/pypdf/security/advisories/GHSA-763m-79hh-57f2). A clean advisory scan does not prove the absence of unknown vulnerabilities.

The dependency gate runs `npm audit --audit-level=low` for runtime **and build/test** packages. The SDK upgrade removes the old [jsondiffpatch prototype-pollution dependency](https://github.com/advisories/GHSA-j4fx-xxwh-2485). The lockfile includes [xmldom's patched parser](https://github.com/xmldom/xmldom/security/advisories/GHSA-965w-775f-mr7g); the scoped `@ai-sdk/provider-utils` override selects a [patched Undici 6.x](https://github.com/nodejs/undici/security/advisories/GHSA-8xcm-r25x-g524) because that SDK branch still declares Undici 5.x. Remove the override only when its upstream dependency is safe. `openai-compatible-http.test.ts` tests the actual SDK's conversation/image wire format, forced structured tool calls, schema rejection, timeouts and cancellation against a local HTTP server. It never calls a live model.

PDF fixtures use a deterministic planner, real HTTP and document workers, and a fixture RDB client. They do not establish live model quality or live database compatibility. Reports are retained in the printed temporary directory; Electron traces/screenshots are under `test/product-qa/runs`.

The deterministic gate clears inherited QA filters, print-only flags, profile overrides and `AX_LIVE_DISCOVERY_MODEL`. On Windows, the existing three POSIX-only path tests and five opt-in live-model tests are conditionally skipped; they are not counted as passed. Live-model acceptance must be run explicitly outside this local gate.

The additional Electron lifecycle test seeds a real database, verifies interrupted execution recovery, clears only finished activity, and restarts again to check that the pending approval and conversation survive. It does not replace IPC handlers. To run it against an existing package, set `AX_PRODUCT_QA_EXECUTABLE` to its absolute executable path, `AX_PRODUCT_QA_MODE=deterministic` and `AX_PRODUCT_QA_ISOLATED=1`, then run `npx playwright test --config test/product-qa/playwright.config.ts release-lifecycle.spec.ts`.

## Packaged startup and installation acceptance

`--package` also checks Windows product/version resources and runs `installed-app.mjs` twice each with ordinary legacy data and a deliberately damaged OS credential. These runs use the **real production startup**, without `AX_E2E`, `AX_PRODUCT_QA`, fake agents or replaced IPC handlers. The app migrates a synthetic legacy SQLite database and document, encrypts a synthetic legacy API key through Windows DPAPI, retains pending approvals/history, and reopens the same state. The damaged-key case verifies that the app remains usable, displays a recovery message, and accepts an explicit replacement through the real settings UI. A second process verifies the replacement is still decryptable. Credentials, home directory and Electron profile are all isolated; no real account data is copied.

On a **disposable Windows runner/account**, test the actual NSIS installer:

```powershell
./test/release/windows-installer.ps1 -Installer 'D:/AX_studio/apps/desktop/release/AX Studio Setup 0.1.0.exe' -AllowHostInstall
```

The script refuses an existing installation registry key, shortcut, installer cache or running AX Studio process. It installs into a new temporary directory, runs real-startup acceptance, reinstalls, uninstalls, verifies data/credential hashes are unchanged, reinstalls again and verifies retained-data recovery. It removes only its own installation/cache and retains synthetic evidence in the printed directory. Windows CI executes this on its fresh runner without the local opt-in. The local package gate does **not** silently install/uninstall applications on the developer's PC.

Without `-PreviousInstaller`, the test covers a **same-version reinstall**, not an upgrade from a historic release. Supplying an actual trusted earlier installer with `-PreviousInstaller` additionally tests binary-version replacement and synthetic-data retention. The fixture is created with the current core schema, so it does **not** establish compatibility with every historic database schema; that requires real versioned migration fixtures as well. Do not substitute a relabeled current build and call it backward compatibility.

The normal Windows configuration disables signing only (`signExecutable: false`), while still applying the existing AX Studio artwork, product name and version. **Unsigned builds can be distributed through GitHub Releases.** Code signing is optional for this distribution channel, not a release prerequisite. The release notes must disclose that Windows may show an unknown-publisher or SmartScreen warning; managed devices may prohibit installation. Signing does not itself guarantee that a new build avoids reputation warnings. See [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) and [Microsoft's SmartScreen guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

If a signing identity becomes available, `npm run pack:win:signed -w @ax-studio/desktop` is an optional fail-closed signing build. Its separate configuration enables signing, sets `forceCodeSigning: true`, writes to `apps/desktop/release/signed`, and requires valid Windows trust verification of both the application and installer. Supply the approved identity securely through electron-builder's configuration/environment; never put a private key or password in source control or chat. This optional command cannot complete without valid signing access.

## Explicit live-model acceptance

```powershell
$env:AX_LIVE_DISCOVERY_MODEL = 'gpt-5.5'
npm run test -w @ax-studio/core -- src/documents/reporting/planner/live-discovery.test.ts --reporter=verbose
Remove-Item Env:AX_LIVE_DISCOVERY_MODEL
```

This uses the logged-in Codex CLI and synthetic source evidence only. It consumes model usage but does not connect to Gmail/Slack or send messages. On 2026-09-12, Codex CLI 0.153.2 with `gpt-5.5` passed all five cases (sufficient evidence, ambiguity, corrected month, leap month and missing source/period). Total test time was 264.51 seconds; the leap-month case took 196.59 seconds. This is one observed quality acceptance run, not a latency SLA or proof of reliability over repeated live-model calls. API-provider transport is tested independently against real loopback HTTP by the core suite.

Passing these gates does not publish anything. Before uploading a release, verify the actual installer on a fresh Windows environment, review the applicable project/dependency licenses, and provide release notes and checksums for the tested assets. Test a real prior-version upgrade when claiming upgrade compatibility. Authenticated Gmail/Slack acceptance needs approved test accounts/targets; clearly disclose when those live paths have not been verified instead of presenting fixture tests as live acceptance. A local installer attempt was correctly blocked by an existing AX Studio installation footprint; that installation and its data were not modified.
