# PRD-360 follow-up — first-use compile coverage

One lever from [the Opus handoff](README.md) step 4: **compile coverage of the shadow and output
first-use work**. Red first, then the fix, then the counts on a real GPU. The serial-async-scheduling
lever was not attempted; the device A/B is not run.

## The defect

`compileAsync` walks the main render list and nothing else
(`packages/core/node_modules/three/build/three.webgpu.js:60185`-`:60245`). Two kinds of pipeline are
therefore unreachable from a compile walk:

- the **shadow pass**, rendered from the light's own node update inside `render()` (`:45416`,
  `:45521`, override material named `ShadowMaterial` at `:44657`);
- the **output conversion** that resolves the frame to the canvas.

Both are built synchronously the first time a frame actually draws. `warmUpScene` returned
`abandoned: 0, timedOut: false` anyway, and nothing in the report said what it had not covered.
That is the condition the handoff names: a green warm-up report must not hide synchronous work in
the first presented frame.

## Red

`pnpm exec vitest run packages/core/__tests__/warmup.spec.ts`, before the fix:

```
 Test Files  1 failed (1)
      Tests  5 failed | 19 passed (24)
```

The five are the new `scene warm-up first-use coverage` cases: the seam is never called, the report
carries no `firstUseRendered`, and a warm-up that left first-use work uncovered still stored a
persistent cache hint that would make the next launch skip the whole walk.

## Green

Same command, after the fix:

```
 Test Files  1 passed (1)
      Tests  24 passed (24)
```

## The change

| Layer | File | What |
| --- | --- | --- |
| engine | `packages/core/src/warmup.ts` | `IWarmUpOptions.firstUseRender`, a caller-supplied render run once at the end of the warm-up window after a yielded frame; `IWarmUpReport.firstUseRendered` / `firstUseFailure`; an exhausted budget skips it and says so; an uncovered warm-up never stores the persistent hint |
| engine | `packages/core/src/game.ts` | `coveredFirstUseRender()` supplies it to both warm-up call sites, and both `TN_WARMUP` markers report it |

The seam is the caller's because only the caller knows whether the frame it is about to draw is
hidden. `game.ts` supplies it only while an opaque startup layer covers the canvas; a game whose
loading surface is a transparent HUD gets no early world frame, because that would be a look change
bought for a compile. Nothing here decides how anything looks, and no default appearance moved.

## Measured, on hardware

Desktop native host, `packages/runtime-native/build/tn-linux/mystral`, adapter from the host's own
log: **NVIDIA GeForce RTX 2080**, Vulkan (`logs/arm-warm-firstuse-firstuse.log`). Same probe, same
scene, same process shape as the arms in [the handoff](README.md); the new arm differs from the
shipped default in one option.

```
node artifacts/prd360-followup/compile-probe/build.mjs
node artifacts/prd360-followup/compile-probe/run-arms.mjs arm-warm-scene arm-warm-firstuse --tag=firstuse
```

| Arm | `warmup` phase | `render-1` — the first drawn frame |
| --- | --- | --- |
| `arm-warm-scene` (shipped default) | 4 (2 async / 2 sync), 13 passes, 11.945 ms hooked | **2 pipelines, both synchronous**, 3 passes, 4.399 ms hooked |
| `arm-warm-firstuse` (this change) | **6 (2 async / 4 sync)**, 16 passes, 14.309 ms hooked | **0 pipelines**, 3 passes, **0 ms hooked** |

The two that moved are the pair the probe already named: the `ShadowMaterial` pipeline at
1024×1024 and `outputColorTransform` at the canvas. `render-2` and `render-3` build nothing in
either arm, as before.

### Appearance did not change

`node artifacts/prd360-followup/compile-probe/compare-shots.mjs arm-warm-scene-firstuse arm-warm-firstuse-firstuse`,
against the untouched no-warm control:

```
arm-warm-scene-firstuse vs arm-no-warm: pixelMismatchRatio=0 perceptualDeltaE=0 (1280x720)
arm-warm-firstuse-firstuse vs arm-no-warm: pixelMismatchRatio=0 perceptualDeltaE=0 (1280x720)
```

## Gates

```
pnpm typecheck   # Done, every package
pnpm lint        # Found 653 warnings   (exit 0; the same pre-existing count)
pnpm test        # Test Files 407 passed | 1 skipped (408)
                 # Tests 4669 passed | 5 skipped (4674)
```

Three existing `game.spec.ts` cases changed with the behaviour they specify — the render sequence
behind an opaque layer now contains the warm-up's own hidden world frame before the loop's first
one, and they assert that frame explicitly rather than being relaxed.

## What this does not establish

- **Nothing about the Pixel 8.** No device run was made; its owner needed the phone. The counts
  above are an RTX 2080 on Vulkan, and the per-pipeline cost that makes this matter is the Mali
  driver's, not this one's. PRD-360 stays PARTIAL.
- **No benefit for Bayview yet.** The sandbox's loading surface is a transparent React HUD, so
  `canvasLayer.opaque` is false and `game.ts` supplies no seam there. Until that game declares an
  opaque startup layer, this change does not alter its launch. Measuring it as if it did would be
  a false result.
- **The 103-pipeline shape is unmeasured.** How many of the real game's synchronous first-frame
  pipelines are shadow variants is still unknown; the browser census attempted for it did not run
  (below).
- **No playtest scenario.** The runtime behaviour is proved by the unit sequence tests and by the
  native-host probe on a real adapter; a scenario over a game with an opaque startup layer remains
  the open gate.
- **The serial `compileAsync` loop is untouched.** three processes its queued work one object at a
  time (`:60259`, `:60278`, `:60285`); that lever is still open and needs a device to judge.

## The browser census that did not run

An attempt to count the real Bayview scene's pipelines by group, by patching `GPUDevice.prototype`
in the dev-server page, produced no rows: on a real NVIDIA RTX 2080 adapter the page never presented
a frame, sat at `ASSETS READY · PREPARING SCENE` for over 90 s after logging
`TN_FPS_BOOT_MS:{…,"sinceNavigation":6346}`, and then stopped answering CDP evaluations. **The
control rules the instrumentation out**: the same page with the instrument removed behaved
identically. This is an observation about the sandbox's dev-server launch on this machine, not a
measurement of anything, and nothing above rests on it. The handoff's own browser proof used the
playtest runner with `--headed --browser-recipe webgpu`, which is a different launch path.
