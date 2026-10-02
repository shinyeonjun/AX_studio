# Disposable Windows installer acceptance

This is a source-only restoration for review. No local NSIS installation,
application launch, registry write, credential-store write, workflow dispatch,
push, PR, merge or release is part of the local validation procedure.

Local checks:

```powershell
npm run test:release:contracts
Get-ChildItem test/release/*.mjs | ForEach-Object { node --check $_.FullName }
Get-ChildItem test/release/*.ps1 | ForEach-Object {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors.Count) { throw ($errors | Out-String) }
}
./test/release/windows-installer.ps1 -Installer 'C:\must-never-execute.exe' -DryRun
git diff --check
```

The dry-run creates no marker, installation, synthetic profile or registry
footprint. It reports why the current environment is blocked. There is no local
installation override. `runner-safety.mjs --initialize` also refuses local user
accounts and self-hosted runners before creating any file.

After source review, a maintainer can manually dispatch
`.github/workflows/windows-installer.yml` on the reviewed commit. Both matrix jobs
use fresh `windows-2025` GitHub-hosted x64 runners, contents-read permissions and
an explicit disposable opt-in. The scripts require all hosted runner variables,
the actual `runneradmin` OS account/profile, matching runner-temp/workspace roots,
a new per-job marker bound to run/attempt/job/source SHA, and no existing AX
profile, registration, process, shortcut or updater cache. A hosted image/account
layout change fails closed and requires review of the guard.

`clean-lifecycle` verifies these real operations in sequence:

1. Verify exact source SHA, version, PE product/file versions, signature status,
   installer/blockmap hashes and the entire unpacked payload inventory.
2. Install the same NSIS asset per-user into the owned runner-temp directory.
   Verify the installed payload bytes and per-user registration before startup.
3. First launch the installed executable with an empty synthetic profile, data
   root and home. Require usable startup, an empty history/approval list, no
   configured API key and a real migration marker. Then use a separate owned
   profile without E2E/fake flags to migrate a synthetic
   legacy database/document/config, recover an interrupted execution, preserve a
   pending approval, and encrypt a synthetic API key with real Windows DPAPI.
   No provider requests, connection tests, mail delivery or approval execution run.
4. Use the installed Python and installed PDF reader/writer to create/read a
   synthetic PDF. Attach it through production IPC and the native file dialog,
   wait for `ready`, a persisted document artifact and independently expected
   extracted text, exercising the real packaged document worker. Export a synthetic stored result
   through the actual activity UI, native Save dialog and production copy IPC.
5. Close and restart. Require the installed app's saved chat, exported bytes,
   attached source, approval, history and encrypted credential to persist, and
   require the migration marker to remain unchanged.
6. Reinstall the identical current installer and repeat reopen checks.
7. Snapshot every synthetic app-data file and hash. Uninstall with confirmed NSIS
   completion; require all packaged payload files and registration/shortcuts to
   disappear while the synthetic data inventory remains byte-for-byte identical.
8. Reinstall current, reopen retained data/credentials, and uninstall again.

The byte-preservation snapshot covers every file under `AX_DATA_ROOT` (the owned
`app-data` directory). It does not compare every Electron-profile, home or temp
file. Legacy DB, saved chat, credential and exported-file checks cover the stated
individual behaviors. A fresh snapshot/comparison around the final uninstall,
Unicode paths and the safe preview build revision are proposed in
[ADR 0002](../../docs/adr/0002-disposable-windows-installer-acceptance.md); that local
implementation is held pending independent ADR review and validation.

`preview-upgrade` first rebuilds immutable preview
`0ba5e22f54cc9fe2bb777f085290bb03de5f457b` (`0.1.0-preview.1`) and its Core Store.
The fixture generator imports that exact preview's compiled Store/schema, never
the current schema. The installed preview then performs real migration, saves
the chat through its real IPC, closes, and restarts before current is installed
over it. Producer version/source and the database hash after installed-app
persistence are recorded. Reopen never reseeds or recreates results.

The preview fixture includes `output_json` with synthetic total `731` and durable
append-only log-tail entries for interrupted/pending executions. Upgrade must
preserve physical SQLite values and expose them in both `getExecution` and
`listExecutions`, `hasOutput`, real preload/lazy `getExecutionOutput` IPC and the
rendered `CalculatedOutput` UI. Pending tail text must reach the actual activity
UI. Raw-value retention alone cannot pass. At base
`3dd272aaeffc5feb42ab63ce8507357f3baae965` the separate compatibility reproduction
reports missing projections/IPC/UI; this job is expected to fail until the
separate product fix is integrated. There is no waiver, test skip or
`continue-on-error`. A failing upgrade is recorded independently from the clean
installation lifecycle; later upgrade-only operations do not receive a pass.

Safety is rechecked before every executable and native dialog action. Removal
requires both current-user registry locations to still name the owned directory,
the expected installed version, and the previously hashed owned uninstaller.
Timeout or changed ownership blocks cleanup and retries. No script manually
deletes registry entries, updater caches, existing user profiles or retained
data; the disposable job runner owns cleanup. Ordinary E2E packaging smoke in
the existing packaging command remains separate from this real startup evidence.

The workflow keeps source/asset manifests and per-stage synthetic JSON, PNG and
exported PDF evidence. It does not upload databases, credential files or whole
profiles. PE editing is enabled to restore product/version resources; signature
validation is not bypassed. Unsigned artifacts are recorded as `NotSigned` and
are not evidence of a signed release. Update-feed metadata, if produced, must
match the exact installer path/version/SHA512; absence is recorded explicitly
because this app currently has no published update feed.

The reusable starting points are the preview's `windows-installer.ps1`,
`installed-app.mjs`, and `package-metadata.ps1`. Historic
[CI run 34714180358](https://github.com/shinyeonjun/AX_studio/actions/runs/34714180358)
passed same-version preview reinstall, uninstall retention and recovery. It did
not execute a previous-version-to-current upgrade. Its artifact listing is now
empty, so the plan rebuilds the pinned baseline rather than assuming the historic
installer is still downloadable. Rebuilt asset hashes must be recorded for the
new run; they are not assumed to equal the historical build's hashes.
