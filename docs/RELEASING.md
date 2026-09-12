# Windows / GitHub Releases

The release target is the Windows x64 NSIS installer. Code signing is optional for
GitHub Releases. Do not turn missing signing credentials into a release blocker.
Do not describe a local package smoke test as a clean-machine installation test.

## Prepare and verify

1. Review project and bundled dependency licenses before distributing binaries.
   The document engine currently includes PyMuPDF/MuPDF, which offer AGPL and
   commercial licenses. A public repository without a project license is not a
   substitute for choosing an open-source license. See the
   [PyMuPDF license](https://pymupdf.readthedocs.io/en/latest/about.html#license-and-copyright)
   and [GitHub licensing guide](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository).
2. Keep the core and desktop versions consistent. Select a new tag; never replace
   the existing `v0.1.0-demo` tag or its assets.
3. Run `npm ci`, install the Python dependencies, and run
   `npm run verify:release -- --package` on Windows. Preserve the test evidence.
4. Run the CI workflow on the exact release commit. Require **both** `verify` and
   `windows desktop` to pass. Windows CI installs the real NSIS artifact on a
   fresh runner, reopens migrated data, reinstalls, uninstalls and verifies
   retained-data recovery. It uploads assets only after those checks pass.
5. Download `windows-release-<commit SHA>` from that successful run. Independently
   verify `SHA256SUMS.txt` against the installer and blockmap. Publish those exact
   files, not a later untested rebuild. Associate the release tag with that same
   commit and retain the CI URL in the release notes.
6. Include the applicable license and dependency notices, supported platform,
   installation instructions, changes and known limitations. Review the draft
   before publishing; the verification scripts do not publish or create tags.

The ordinary package is unsigned. A signing identity, if available later, can be
used with `npm run pack:win:signed -w @ax-studio/desktop`. A checksum detects a
different/corrupted download; it does not establish publisher identity like a
trusted code signature does.

## Information users need

- Download the installer from this repository's Releases page and run it as the
  current user. Administrator access is not required for a per-user install.
- This release is unsigned. Windows may display an unknown-publisher or
  SmartScreen warning, and managed-device policies may prevent installation.
  Do not advise users to disable antivirus or device security globally.
- Configure an AI provider in the app settings. API mode needs the user's own
  API key; CLI mode needs the selected CLI installed and authenticated. Provider
  usage and service charges are separate from the application.
- The default CI build has no embedded Google OAuth client. Gmail requires an
  appropriately configured desktop OAuth client; do not advertise out-of-box
  Gmail login for that build. Building with one's own OAuth client and accepting
  Gmail/Slack with approved test accounts are separate from fixture-based tests.
- Schedules require AX Studio to remain running, including in the tray. Closing
  the window is not the same as quitting the app. An unavailable/offline service
  can prevent a scheduled action from completing.
- Installed data is stored under `%LOCALAPPDATA%\AXStudio`; development data uses
  `%LOCALAPPDATA%\AXStudio-dev`. Quit the app before making a backup. Encrypted
  credentials are tied to the OS account; copying their files to another PC is
  not a supported credential transfer. Re-enter keys on the destination PC.
- The uninstaller retains user data. It does not revoke Gmail/Slack access at the
  provider. Disconnect accounts/revoke permissions separately when retiring the
  application; delete local data only after preserving anything needed.
- If the app stops during an external send, the result may be uncertain. On
  restart the execution is failed and its automatic workflow is paused. Check
  the destination service before manually retrying, to avoid duplicate sends.

## Evidence boundaries

The release suite covers real local HTTP, concurrent approval, process-kill
recovery, real SQLite persistence, OS credential encryption/recovery, packaged
startup and real PDF output. Deterministic product QA does not prove arbitrary
live-model quality or successful delivery to real Gmail/Slack accounts. A
same-version reinstall is not a historic-version database migration test.

Record failures and unverified paths honestly in the release notes. Do not
publish a stable-release claim solely because a build or unsigned package exists.
