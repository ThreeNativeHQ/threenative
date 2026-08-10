# G2 — conformance

**Milestone:** M3
**State:** open. The current registry has 66 rows, all implemented. One coherent revision
passes all 66 visual rows on browser, Linux desktop, and the API-35 Android emulator. The
aggregate Android command remains non-green because PRD-053's multi-touch supplemental fails,
and the literal clean-machine desktop prerequisite in PRD-054 acceptance criterion 1 remains
unsatisfied.

Reports must state the result as a fraction and must not summarize an empty, bounded, or
dry-run-only report as “the harness passes.” Acceptance requires browser and native
completion, finite visual metrics, clean GPU validation output, and explicit blocked/planned
rows.

## Bounded Linux execution — 2026-08-08

```sh
SDL_VIDEODRIVER=x11 \
TN_RUNTIME=/home/joao/projects/threejs-webgpu/packages/runtime-native/build/tn-linux/mystral \
TN_BROWSER_TIMEOUT_MS=30000 \
xvfb-run -a -s '-screen 0 1600x900x24' \
node packages/runtime-native/conformance/run-conformance.mjs \
  --only-tests 70-webgpu-renderer-init,89-module-import \
  --allow-blocked --out artifacts/conformance/report-2026-08-08.json
```

Both rows completed in Firefox and Linux V8+Dawn. Each reported
`pixelMismatchRatio=0.00007582720588235293`, `perceptualDeltaE=0.6168589999999999`, and
zero GPU validation errors, below tolerances `0.01` and `3.0`. The fraction is **2/49**.
Eleven other implemented rows were not selected and are blocked; 36 remain planned.

The run also corrected a harness error: ImageMagick Q16-HDRI absolute error was divided by
pixel count without first dividing by the 65,535 quantum range. Focused tests prove Q16
normalization and reject unknown quantum depth.

## Project and device targets

`pnpm parity --project <path>` now resolves the scaffold's configured portable native entry,
uses it for browser, desktop, and checksum-locked Android bundles, and stages `public/` assets.
Dry-bundle tests cover the project contract. All three runtime lanes executed real minimal,
starter, and platformer scaffolds and captured their generated HUDs. A generic cross-target
project verdict is not claimed: time-dependent shaders and asynchronous scene transitions
made whole-frame snapshots unstable because the three hosts capture at different wall-clock
phases. An explicit project capture-readiness/state protocol is still required.

The native-platform workflow has a path-filtered Android emulator job for runtime-native,
lockfile, workspace-catalog, and workflow changes. Physical Android is a distinct
`android-hardware` report target and remains blocked until an attached non-emulator device is
actually selected and executed.

The non-project Android lane also aggregates the standalone native-smoke multitouch proof.
That proof is currently a known failure, so Android/all parity remains non-green; visual row
reports are still written before the aggregate exit code is selected.

## Toon regression and Android color — 2026-08-09

The isolated wgpu-native matrix discriminated the named regression: v24.0.3.1 failed with
the naga `textureLoad` rejection and v25.0.2.2 passed 300 desktop frames with mismatch
`0.00023546`, zero GPU validation errors, and a non-uniform capture.

Android's sRGB-only surface originally applied a second output transfer. The host now renders
Three's already-encoded output into a linear intermediate and decodes it in a fullscreen
presentation pass before the real sRGB attachment transfer. Bounded row 15 then matched the
browser exactly: background `(24,32,47)`, center `(237,151,55)`, mismatch `0`, delta E `0`,
checksum-verified APK, clean WebGPU logs, and a live process. See
`docs/verification/prd-054-android-color-2026-08-09.md`.

## Full browser and Linux desktop execution — 2026-08-09

All 22 formerly planned rows now have deterministic same-source scenes with fail-closed
semantic tests. The completed registry includes real GLTFLoader GLB/external-resource loads,
animation mixer/skeleton/morph rows, offscreen readback, postprocessing, TSL, storage buffers,
compute, captured GPU validation scopes, and submitted-work completion. The native host now
forwards WebGPU error scopes and queue completion callbacks across Dawn, wgpu-native v25, and
the v24 compatibility build; it also exposes the minimal event constructors and dispatch path
used by the event rows.

```sh
xvfb-run -a -s '-screen 0 1600x900x24' \
  node packages/runtime-native/conformance/run-conformance.mjs \
  --target web --out .runtime/conformance-final-web

xvfb-run -a -s '-screen 0 1600x900x24' \
  node packages/runtime-native/conformance/run-conformance.mjs \
  --target desktop --reference .runtime/conformance-final-web \
  --out .runtime/conformance-final-desktop
```

Both reports are **66/66 pass**, with zero failed, blocked, or planned rows. Every capture is
1280×720 and non-uniform, every desktop row completed 300 frames, and no row reported a GPU
validation error. Linux execution explicitly selects SDL's X11 backend because the native
surface path does not support Wayland.

The final Android report also passes **66/66 visual rows**, with zero failed, blocked, or
planned rows. Its largest mismatch is `0.0038216145833333335` on row 61. Every row uses a
fresh checksum-verified install; a two-second uninstall reclamation window prevents the 236 MB
debug APK from exhausting emulator storage through deferred replacement cleanup. The
corrected supplemental command still fails after its healthy 300-frame first proof because
the positive multi-touch scenario observes no pointers. Aggregate parity therefore remains
honestly non-green even though the complete visual matrix passes.
