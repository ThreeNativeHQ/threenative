# PRD-254 Android high-refresh stopped-lane audit — 2026-08-30

**Verdict:** the four commits ending at `8f689d70` are stale history, not missing capability. Do not
merge them. Current `main` at audit baseline `9b97d704` contains the newer implementation through
`98a963f0`, and the accepted physical Pixel 8 result already lives in
[`runtime-perf-state.md`](runtime-perf-state.md).

## What exists on the public and runtime surfaces

| Contract | Current live caller or seam |
| --- | --- |
| Game-owned `display.maxFps` | `packages/core/src/config.ts`; every generated `threenative.config.ts` |
| Validation and native packaging | `packages/create-threenative/src/config.ts`; Android/iOS/desktop packagers |
| Android display preference | `MystralActivity.requestPreferredFrameRate()` calls `Surface.setFrameRate()` after surface creation and resume |
| Native presentation ceiling | `Runtime::run()` passes `config_.maxFps` to `setPresentationCapHz()` |

The old branch was not rebased by force. A trial cherry-pick conflicted across 22 generated,
configuration and runtime files; symbol and history inspection then found the consolidated live
implementation. Replaying the branch would replace newer lifecycle and pacing work with older code.

## Current-HEAD gates

From the isolated worktree `audit-prd254-high-refresh-20260830`:

| Gate | Result |
| --- | ---: |
| Config, build and scaffold specs | 113 passed |
| Android packaging, lifecycle, preflight and desktop/iOS packaging specs | 58 passed |
| Root package build | passed |

The existing physical evidence remains authoritative: a Pixel 8 selected physical 120 Hz and the
accepted run sustained 63.45–72.52 fps for 11 steady windows with zero hitches and thermal status 0
before and after. This audit does not relabel emulator output as phone evidence.

## Detached tarball consumer

`pnpm sandbox --genre fps --name prd254-high-refresh-audit --template minimal` produced a project
with zero readable framework source. The game set `display.maxFps: 120` in its public config.

| Mined feature | PRD | What the game asks of it | Proof surface |
| --- | --- | --- | --- |
| `display.maxFps: 120` | PRD-254 high-refresh stopped lane | Keep one portable game playable while opting into the native high-refresh contract | Typecheck, packed-package build, web playtest, Android metadata and device request logs |

The detached game typechecked and built. Its headed NVIDIA/Turing WebGPU playtest passed: the player
moved 2.10 m, the inspected capture was visibly nonblank (`0.9986` nonblank pixel ratio), and console,
network and runtime diagnostics were all zero. This web run proves the same source remains playable;
it does not claim browser refresh selection.

The packed optional runtime correctly reported that no `v0.3.0` native prebuilt release exists, so
the detached project cannot manufacture an Android binary. A source-machine APK was therefore run
only as a separate emulator check. APK SHA-256
`037ea4e42ffa408cd0b7c2b9cc6a0e90d70e0e9242de93d880fa622872f0339a` packaged
`TN_MAX_FPS=240`, cold-started on `emulator-5554` (`sdk_gphone64_x86_64`), logged two applied
`TN_DISPLAY_FRAME_RATE_REQUEST` events, `maxFps=240`, `Presentation cap: 240 fps`,
`TN_NATIVE_SMOKE_READY:webgpu`, and `TN_NATIVE_SMOKE_FIRST_FRAME`. This is emulator lifecycle
evidence, not achieved-refresh or physical-device evidence.

## Observed-red controls

1. Detached consumer: mutate `display.maxFps` from `120` to `120.5`.
   `pnpm build` exits 1 with `TN_CONFIG_MAX_FPS_INVALID` and names the whole-number range. Restoring
   `120` builds green.
2. Runtime lifecycle: remove the production `Surface.setFrameRate()` call.
   `Android activity retrieves config metadata through PackageManager` exits 1 with
   `max-fps metadata was not requested from the Android surface`. Restoring the call passes.

No product code was added: the audit closes a stale branch decision and preserves the newer shipped
implementation.
