# PRD-249 fluid field verification — 2026-08-29

Result: the field is proven on web and Linux desktop native, including the example's native input
path. The Pixel 8 lane did not execute, so this record makes no mobile-readiness claim; the
documented target is desktop and web until a physical Android lane is available.

## Resolved file set

- `packages/core/src/fluid-field.ts`
- `packages/core/src/index.ts`
- `packages/core/__tests__/fluid-field.spec.ts`
- `examples/prd249-fluid-field/**`
- `packages/runtime-native/conformance/registry.json`
- generated capability manifests and reference
- `docs/verification/prd-249-fluid-field-2026-08-29.md`
- `docs/verification/assets/prd-249-fluid-field/*.png` (captures removed from the repo by
  `79aa9de1`, 2026-09-01; the table above carries the measured evidence)
- `pnpm-lock.yaml`

The native execution used an isolated prerequisite overlay containing PRD-242 at commit
`636f0c6d`; this lane's base predates that dependency and no PRD-242 file is part of this change.

## Positive evidence

| Proof | Result | Observed evidence |
|---|---|---|
| Unit contract | PASS | `pnpm exec vitest run packages/core/__tests__/fluid-field.spec.ts` — 5 passed, including the nonzero-vorticity tangent regression. The pre-fix run was red: `(-0.8, 0.6)` did not match the required `(0.6, -0.8)`. |
| Web example | PASS | The overlay-backed playtest command `sh scripts/xvfb.sh node packages/playtest/dist/runner/cli.js /tmp/prd249-base.p9qZb0/examples/prd249-fluid-field/playtests/fluid-field.playtest.json --url http://127.0.0.1:5182 --server-command 'pnpm --dir /tmp/prd249-base.p9qZb0 --filter prd249-fluid-field dev --host 127.0.0.1 --port 5182 --strictPort' --browser-recipe webgpu --headed` exited `0`; `changedPixelRatio` was `0.007865668402777777`, `steps` changed `48 → 116`, `splats` changed `0 → 1`, and diagnostics/network/console errors were zero. |
| Desktop native example input | PASS | `fluid-field-desktop.playtest.json` targeted `desktop` and sent `Space` through the native mailbox. `GameState.steps` changed `29 → 74`, `splats` changed `0 → 1`, and the saved `unsplatted.png`/`settled-native-splat.png` frames differed at `0.007865668402777777`. The run used the isolated PRD-242 prerequisite overlay because this lane's base predates that dependency; it did not use `src/conformance.js`'s hard-coded splat. |
| Web conformance | PASS | `sh scripts/xvfb.sh node packages/runtime-native/conformance/run-conformance.mjs --target web --only-tests 77-fluid-field` — report `pass 1 fail 0 blocked 70`; the runner exits `2` because unselected rows are blocked; dye range `0..0.7237864136695862`; raw mean absolute divergence `0.0017316938608125008`. |
| Desktop native conformance | PASS | `MYSTRAL_BIN=/tmp/prd249-base.p9qZb0/packages/runtime-native/build/tn-linux/mystral node packages/runtime-native/conformance/run-conformance.mjs --target desktop --only-tests 77-fluid-field` — report `pass 1 fail 0 blocked 70`; the runner exits `2` because unselected rows are blocked; pixel mismatch `0.0020941840277777777`, DeltaE `0.022014509476168138`, GPU validation errors `[]`. |
| Look ownership | PASS | The smoke and fire surfaces read the same `field.dye` sampler from `examples/prd249-fluid-field/src/render/fluid.ts`; the captures below are separate crops from one post-splat frame. |

The smoke and fire captures that illustrated this section were removed from the repository by
`79aa9de1`; the pass/fail rows above are the retained evidence.

The executable conformance assertion and generated `FluidField2D` capability entry carry the
threshold: mean absolute velocity divergence must stay below `0.0025`; the measured sample was
`0.0017316938608125008` after four 32² steps with `pressureIterations 2`.

### Pressure-proof calibration

The old `< 0.01` threshold accepted the no-pressure mutation: the selected web conformance
command above reported `pass 1 fail 0 blocked 70` with `pressureIterations: 0` and measured mean
absolute divergence `0.003183`. After changing only the threshold to `< 0.0025`, the same mutation
was red: the report was `pass 0 fail 1 blocked 70`, with
`fluid field mean absolute divergence 0.003183 must stay below 0.0025`. Restoring the intended
`pressureIterations: 2` setup was green: `pass 1 fail 0 blocked 70`, measured
`0.0017316938608125008` (reported as `0.001732` in the detail payload). The positive margin is
`0.0007683061391874992`; the zero-iteration mutation exceeds the threshold by `0.000683`.

For these browser calibration runs, the lane temporarily imported `warmUpScene` from the isolated
PRD-242 prerequisite overlay named below; that import was restored before delivery. This supplies
the missing warm-up API without adding prerequisite files to the lane.

The repair checks also passed with these exact commands:

```text
pnpm exec vitest run packages/core/__tests__/fluid-field.spec.ts
# PASS — 1 file, 5 tests

pnpm --filter prd249-fluid-field typecheck
# PASS — tsc --noEmit -p tsconfig.json

pnpm --filter prd249-fluid-field build
# PASS — Vite transformed 84 modules and built the example

pnpm build
# PASS — regenerated both capability manifests and the capability reference; workspace builds completed
```

The current lane-base conformance rerun is setup-blocked before the selected row: its pre-PRD-242
`warmUpScene` has no `computeNodes` support and therefore reports `fluid field warm-up must compile
every ordered solver pass`. The exact command
`sh scripts/xvfb.sh node packages/runtime-native/conformance/run-conformance.mjs --target web --only-tests 77-fluid-field`
therefore fails before the selected row. A direct lane-base web playtest also exited `1` with
`steps 0 → 0` and `changedPixelRatio 0` because the pre-PRD-242 lifecycle does not dispatch the
field. The conformance results and example-input run above use the isolated PRD-242 prerequisite
overlay named above; this repair does not import those dependency files into the lane.

## Desktop cost

Each run used the native `mystral` host with `--no-vsync --frames 900`; window 1 was discarded as
startup. Values below are steady window 2 from `TN_FRAME_BUDGET`, in milliseconds, on this Linux
desktop. `render.p50` is the PRD-249 cost figure; `frame.p50` is the complete callback.

| Field resolution | frame.p50 | update.p50 | render.p50 | present mode |
|---:|---:|---:|---:|---|
| 128² | 0.97 | 0.25 | 0.71 | immediate |
| 256² | 1.02 | 0.27 | 0.73 | immediate |
| 512² | 1.18 | 0.29 | 0.88 | immediate |

Commands used the same bundled example entry for each resolution. The native logs completed 900
frames with no `validation error` line. The field's GPU texture allocation rose from the 128²
run's 8 `128x128 rgba32float` textures to the corresponding 256² and 512² pairs; the host's
`TN_FRAME_BUDGET` render phase is the comparable per-frame measurement.

## Android and Pixel 8 boundary

`adb devices -l` exposed only `emulator-5554` (`sdk_gphone64_x86_64`), not a physical Pixel 8.
The Android dependency probe was also attempted with:

```sh
node packages/runtime-native/scripts/download-deps.mjs --android
```

SDL dependencies downloaded, but the pinned V8 artifact failed the repository's 16 KB check:
`Android 16 KB alignment check failed ... libv8android.so ... LOAD alignments 0x1000 ... expected
every segment >=0x4000`. Therefore there is no Pixel 8 number in this record, and the emulator is
not substituted for that criterion. Mobile fit remains unmeasured; desktop and web are the only
claimed targets.

Native field texture readback is another known runtime boundary: the native visual conformance
passed with the solver and material running, while the conformance case logs
`FLUID_NATIVE_READBACK:skipped; native texture readback is unavailable`. Browser readback supplies
the numerical divergence and dye-range measurements.

## Evidence matrix

These temporary mutations were each restored before the positive run and are recorded here so a
uniform or unchanged result cannot be mistaken for proof:

| Mutation | Observed red result |
|---|---|
| Remove `ctx.add(field)` from the example | Headed WebGPU playtest exited `1`; frame diff was `0` and `steps` stayed `0 → 0`. |
| Change `if (amount === 0) return` to `if (amount < 0) return` | Focused Vitest exited `1`: expected `queuedSplats` `0`, received `1`. |
| Stub the conformance solver loop | Desktop conformance exited `1` with `native fluid field must advance four fixed steps`; the captured native frame was uniform (`14 7 5 255` at both first and middle samples). |
| Change only the smoke palette in `src/render/fluid.ts` | The mutated playtest still exited `0`; baseline versus mutant captures differed in `0.004696180555555556` of pixels with mean RGB absolute delta `0.07842628761574075`. No package file changed. |

The scoped implementation grep was clean:

```sh
rg -n -i 'color|colour|palette|dye.?fade' \
  packages/core/src/fluid-field.ts packages/core/__tests__/fluid-field.spec.ts
# no matches
```

The non-fluid byte-parity proof built `examples/native-smoke` from HEAD and from this lane. Both
bundles were `5be39424fa134b22bbade271bd0db97d07867375f4f501d25121a2a5046c3680`; `cmp -s` returned
`BYTE_IDENTICAL:0`.
