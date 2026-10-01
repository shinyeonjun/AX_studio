# Native Linux x64 packaging and acceptance

Supported build target: Linux **glibc x86_64**. Use the repository's pinned
Node version (`.nvmrc`, currently 22.23.2), npm lockfile, GNU tar with zstd,
and the normal Electron runtime shared libraries. Building on another OS,
ARM64, musl/Alpine and macOS packaging are deliberately rejected instead of
silently producing the wrong Python payload.

## Build

```sh
npm ci
npm run test:packaging
npm run pack:linux -w @ax-studio/desktop
```

The native packaging command builds **both core and desktop**, downloads the
checksum-pinned portable CPython 3.13.15 runtime, installs only binary wheels
into that payload, creates `apps/desktop/release/AX Studio-0.1.0.AppImage`,
and verifies `apps/desktop/release/linux-unpacked`. Publishing is explicitly
disabled (`electron-builder --publish never`). No provider account is needed.

`npm run pack -w @ax-studio/desktop` builds only the native unpacked directory.
`npm run pack:win -w @ax-studio/desktop` retains the Windows x64 installer,
`win-unpacked/AX Studio.exe`, and official embeddable Python layout. It must run
on Windows; Linux cross-packaging does not verify a Windows release.

### Headless builds

```sh
npm run pack:linux:build -w @ax-studio/desktop
node scripts/document-engine-install.mjs --verify-package apps/desktop/release/linux-unpacked --skip-ui
```

These commands still require archive integrity, notice presence, relocated
Python, PDF text extraction, both native PDF renderers, OpenCV and the real
worker ingestion checks. They explicitly report graphical startup as **NOT
VERIFIED**. Never treat `--skip-ui` as a complete release acceptance pass.
A full graphical check can be run on a desktop or under an already installed
Xvfb without adding `--no-sandbox` or changing system/kernel security settings:

```sh
xvfb-run --auto-servernum node scripts/document-engine-install.mjs --verify-package apps/desktop/release/linux-unpacked
```

The GUI check uses a new application data root, Chromium profile, HOME and XDG
config/data directories. It strips inherited document-engine overrides and
provider API keys, uses deterministic fake-agent mode and asserts Electron's
`app.isPackaged`. It does not connect real Gmail, Slack or model accounts.

## Portable document engine

Linux uses Astral's immutable `python-build-standalone` release 20260901,
CPython 3.13.15, `x86_64-unknown-linux-gnu`, GIL-enabled
`install_only_stripped`. It is a complete runtime, **not a copied virtualenv**.
The exact URLs and SHA256 values are in `scripts/lib/package-platform.mjs`.
The matching full archive supplies dependency licenses and `PYTHON.json` that
install-only archives omit; build objects are not shipped.

Generated `bundle-manifest.json` records platform, architecture, runtime source
and checksums, and the bundled requirements hash. Requirements ranges are
unchanged from this branch, so wheel resolutions are reported by acceptance
but are not a reproducible dependency lock or a security approval.

The existing core runtime already resolves Linux
`resources/document-engine/python/bin/python3`. Acceptance copies the payload
to a new path containing spaces and Korean text, preserves relative symlinks,
removes host PATH/Python variables, disables the user site, and runs outside
the checkout. It asserts the interpreter prefix and all native modules are
inside the relocated bundle. A missing bundled runtime is an error; the check
never silently falls back to host Python. The core resolver also fails closed
when an installed worker/interpreter is missing; development overrides remain
explicitly supported.

For predownloaded archives, the same SHA256 gate still applies:

```sh
node scripts/document-engine-install.mjs --bundle --runtime-archive /path/to/cpython-install-only.tar.gz --runtime-notices-archive /path/to/cpython-full.tar.zst
node scripts/document-engine-install.mjs --verify-bundle packages/document-engine/out/document-engine
```

Downloads remain restricted to pinned upstream URLs. A local archive path
cannot select a different runtime or override its checksum. Never substitute
a developer venv or an unverified mirror when downloads fail.

## AppImage launch and installation acceptance

AppImage is a portable application and does not install a DEB/RPM or register
a system service. Copying it to a private applications directory and marking
it executable is sufficient for a local launch. Keep test data separate:

```sh
chmod +x 'AX Studio-0.1.0.AppImage'
AX_DATA_ROOT=/tmp/ax-clean-install-data './AX Studio-0.1.0.AppImage'
```

On a machine without working FUSE, the upstream-supported fallback is:

```sh
AX_DATA_ROOT=/tmp/ax-clean-install-data './AX Studio-0.1.0.AppImage' --appimage-extract-and-run
```

Alternatively, `--appimage-extract` writes `squashfs-root` in the current
folder; its `AppRun` or unpacked executable can be inspected/tested there.
Use a new empty folder. Do not extract over a user's working files.

See [AppImage's FUSE troubleshooting](https://docs.appimage.org/user-guide/troubleshooting/fuse.html).
An extract-and-run result verifies that fallback only. It does not certify
native FUSE mounting, desktop integration, upgrade/uninstall behavior,
or a fresh-machine install across other distributions. No security-sensitive
container privileges or kernel changes are required or recommended.

## Separate distribution blockers

Read [PACKAGING_NOTICES.md](PACKAGING_NOTICES.md). This planner branch still
includes PyMuPDF/MuPDF, lacks reconciled root project/release notices, and uses
older PDF dependency ranges. The preview release's permissive-backend notice
must not be copied unchanged. Package creation is local engineering evidence,
not redistribution approval. Reconcile the preview's compatible license,
security and PDF hardening changes deliberately before publishing.

A complete release also needs the normal core/desktop/document regression
suite, type checks, architecture/evaluation checks, dependency audit,
deterministic product QA, an actual packaged-app launch/restart, and target
machine install evidence. Actual Windows builds are not validated by the
platform-layout unit tests on Linux. Keep failed, passed and unrun checks
separate in the release record.
