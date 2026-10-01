# Linux packaging

Build on Linux glibc x86_64 using the Node version in `.nvmrc`, npm, and GNU tar with zstd support.

```sh
npm ci
npm run test:packaging
npm run pack:linux -w @ax-studio/desktop
```

The build produces an AppImage and an unpacked application under `apps/desktop/release/`. The packaging command does not publish them.

Run the AppImage as a normal desktop user on a host that supports its sandbox. If FUSE is unavailable, AppImage supports `--appimage-extract-and-run`.

Retain the project and dependency notices listed in [PACKAGING_NOTICES.md](PACKAGING_NOTICES.md) with redistributed packages. Windows packages must be built and tested on Windows.
