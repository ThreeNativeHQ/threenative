# PRD-243 cloth audit — 2026-08-30

**The example feature execution is green on browser and physical Pixel 8. The shipped-template
Android proof and Pixel 8 performance qualification remain open.**

## What now works

| Lane | Executed result |
| --- | --- |
| Focused units | 15/15 core topology, compute lifecycle, and physics adapter tests passed |
| Starter scaffold | 40/40 scaffold tests passed after regenerating the capability manifest and scaffold hashes |
| Detached consumer | Packed tarballs, isolated `--ignore-workspace` install, typecheck, build, headed NVIDIA Turing WebGPU scenario and inspected capture passed |
| Fresh starter sandbox | Sealed packed snapshot `921cae06752253247a2db15436d548088ecf62c4b9fa0ad9503eb6a296259b9d`; isolated install, typecheck, web build, and headed cloth scenario passed with `0.5049135767` displacement and two readbacks |
| In-repository web | Headed NVIDIA Turing WebGPU: `0.349999994` m displacement, `collisionHeld=1`, outcome `won`, changed-pixel ratio `0.03088`, zero diagnostics |
| Physical Android | Pixel 8 `shiba`, Mali-G715/Vulkan: 248 ticks, `0.349999994` m displacement, `collisionHeld=1`, outcome `won`, zero diagnostics |

The final Android capture is
`/tmp/prd243-cloth-pixel8-bounded-green-20260830/after.png`. It was inspected: the striped cloth is
visibly deformed and remains on the near face of the wireframe wall.

## Red-to-green controls

1. Disconnecting `softBodyCollision` in the detached consumer produced
   `gustDisplacement=0.944432497`, `collisionHeld=0`, outcome `lost`, and exit 1.
2. The first physical run exposed an unbounded game gust: it won at tick 194, then crossed the wall
   by tick 255 with `gustDisplacement=1.928257346`, `collisionHeld=0`, and exit 1.
3. The fixed game stops wind after 30 simulation ticks, and the solver projects swept box-face
   crossings so a half-step cannot tunnel across a thin collider. The same physical scenario then
   passed through tick 248 and the inspected frame stayed bounded.

## Consumer boundary

The sandbox game at
`/home/joao/projects/threenative/threenative-engine/.worktrees/sandbox/prd243-cloth-audit` resolves
`@threenative/core`, physics, and playtest from packed `.tgz` files. Its source and lockfile contain
no `workspace:` dependency or `packages/*/src` reach. Its README maps PRD-243 to the gust,
deformation, collision, outcome, and visual proof.

## Remaining gates

Device doctor observed the Pixel 8 cool, discharging, and at thermal status `NONE`, but at 34%
battery. The harness requires at least 50% before a comparable measurement lane. No per-frame Pixel
8 cost is inferred from this feature run. The physical APK was the dedicated example, not a freshly
scaffolded starter project, so the shipped-template Android acceptance item also remains open.

A fresh starter sandbox APK was then installed on the same Pixel 8. Three attempts failed closed:
the first timed out before the bridge, the menu-driven retry left the native surface invalid after
soft-keyboard interaction, and a final test-only direct-to-Play launch still reported
`TN_SURFACE_ACQUIRE_FAILED` followed by an unfinished GPU frame. The cloth advanced, but
`flagReadbacks` and `flagDisplacement` stayed zero. The doubtful assumption became the starter
native render surface's ability to carry this compute/readback sequence.

A later isolated check removed the menu entirely and launched the starter directly into `Play`
after the normal progress loading screen. The Android emulator still emitted repeated `Failed to
get current texture`, never installed the playtest bridge, and ended a frame with unfinished GPU
objects. A bounded surface-timeout retry did not change that result and was reverted. This rules
out the menu transition and the transient-timeout hypothesis; the unresolved boundary is the
starter render chain's native surface acquisition under this scene.

The final root `pnpm test` rebuilt every package and reached 620 passing runtime-native tests, then
failed four tests because the opt-in `threenative-crash-handler-policy-test` and V8/QuickJS
`threenative-timestamp-query-test` C++ executables are not built in this worktree. This is an
explicit missing-native-build prerequisite, not a cloth assertion failure; the full root gate is
not claimed green.
