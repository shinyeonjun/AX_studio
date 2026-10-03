# Renderer tool-result contracts resolve from reviewed source

Status: Proposed bounded build-configuration repair; independent review pending.
Date: 2026-10-03.

## Observed failure

At main `49b4e1e2`, root `npm run dev` starts Desktop without compiling Core. Main
already resolves Core source, but the renderer's explicit browser-safe source
aliases omit `@ax-studio/core/tool-result`. The Core package correctly exports that
subpath through `dist/contracts/tool-result.js`. Preserved older dist lacks that
file, so Vite fails on the draft-controller import even though main/preload build.
An ordinary root production build compiles Core first and masks this condition.

## Bounded decision

Add `src/contracts/tool-result.ts` to the existing renderer source alias allowlist.
It imports Zod and exposes pure strict schemas and validation helpers. This repairs
the shared-contract boundary in ADR 0004 without importing the Core root, provider
SDKs, persistence or credentials into the renderer. Package exports and normal
Core compilation remain unchanged.

Building all Core before dev is unnecessary for this pure source consumer and
would rewrite preserved dist, add startup cost and make source resolution depend
on bootstrap sequencing. Pointing the renderer at the Core root would violate
the existing browser-safe allowlist. A manual Core build would leave a hidden
prerequisite and would not cover clean source checkouts.

## Verification and rollback

Load the actual Electron-Vite renderer configuration in regression fixtures with
absent and stale Core dist. Resolve and serve the draft-controller and shared
contract through Vite. Separately reproduce exact root `npm run dev` with private
mutable dependencies, owned caches and fresh synthetic profiles, and inspect the
actual loaded renderer rather than inferring startup from a successful build.
Include the focused regression in the existing dependency test command so CI's
prior Core compilation cannot mask absent/stale-dist fixture resolution.
Retain the failing baseline. Confirm normal build/type/unit checks and preserve
canonical outputs, profiles and unrelated processes. Rollback removes only this
specific alias and its focused regression; no data or package migration exists.
