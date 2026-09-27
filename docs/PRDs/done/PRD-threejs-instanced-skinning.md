# PRD: skinned rigs draw as one palette draw per pass

**Status:** DONE — shipped in the render projection, on by default, measured faster on the frozen paired bench, proven on desktop native and the Android emulator.
**Priority:** P2. **PR:** #335. **Base:** develop.

## Goal and ownership

A game that puts many animated `SkinnedMesh` rigs in its scene pays one draw per rig per pass,
shadows included. Make that cost disappear without the game knowing: rigs that share a geometry and
material draw from one storage palette of world-space bone matrices, one instanced draw per pass.

Per the decision below, the standalone prototype in `examples/integrations/skinning` is
replaced by an engine mechanism in `packages/core`, integrated so a game developer never needs to
know it exists, and admitted only on proven performance gains. The prototype, its CI workflow and
its CPU-picking path are deleted: the render projection leaves the authored scene intact, so
raycasts, bounds and animation keep targeting the game's own objects. No InstancedMesh2 code, no
renderer fork, no Three upgrade, no new public API.

How it works: `SceneRenderProjection` routes eligible rigs to a skinned lane
(`packages/core/src/projection-skinned.ts`). Each frame, each rig's `skeleton.update()` output is
written into its slot, folded with the world transform, and uploaded once. The draw's material is a
node twin of the game's material, re-synced every frame, and its version is followed rather than
copied. Hidden and freed slots collapse to zero matrices. A temporal stage gets a previous-pose
palette through `positionPrevious`. Rigs the palette cannot draw exactly keep their own draw, named
in `TN_RENDER_PROJECTION`: `nonUniformScale`, `negativeScale`, `skinned` (a material that moves its
own vertices), `morph`, `transparent`, `tooFewToBatch`, `batchOverflow`.

## Frozen benchmark contract

`pnpm exec tsx scripts/engine-load-test/skinned-crowd.ts` drives
`examples/engine-load-test/skinned-crowd.html`. Fixture: a procedural 32-bone tube rig (4.2k
vertices), independent per-rig poses, a shadow-casting sun and a ground plane. It renders one frame
per animation-frame tick, with 60 warm-up and 300 timed frames per arm, in the order A/A (stock,
stock2) then six stock/projected pairs, on a hardware adapter named in the report. Admission: every
pair faster at 128 rigs and up, and no regression below. Quality: `capture=1` reads back the same
frame from each arm and diffs it against stock.

### Phase 1 — gap and bench
- [x] Capability search: nothing installed batched skinned rigs; the projection filed every rig on the exact lane with reason `skinned`, one draw per rig per pass. proof: `engine_search_capabilities` ("crowd of animated skinned characters") and the pre-change `renderProjection.spec.ts` skinned case
- [x] Bench frozen, and its stock arm made honest. Three refreshes a stock skeleton once per animation-frame tick, so rendering several frames per tick drew stale poses and under-priced stock by about half. The loop now renders once per tick, and stock A/A captures match exactly. proof: `pnpm exec tsx scripts/engine-load-test/skinned-crowd.ts capture=1`

### Phase 2 — engine lane, invisible to games
- [x] Skinned lane in the projection (plan, palette, material twin, history, retirement, named refusals). `packages/core/__tests__/projection-skinned.spec.ts`: 12 passed. With the lane disabled, 5 go red. proof: `pnpm exec vitest run packages/core/__tests__/projection-skinned.spec.ts`
- [x] Palette equals stock skinning for attached, bind-offset and detached rigs, within 1e-5 per element. proof: same spec, `SkinnedBatch palette` block
- [x] The first scan of a still-empty scene no longer waits 60 frames to engage (found by the desktop run). Red without the fix, green with it. proof: same spec, "engages on the frame after a level fills an empty scene"
- [x] Same-frame captures versus stock, shadows on: 0 difference at 128 rigs, max 1/255 at 8 rigs. proof: `skinned-crowd.ts ladder=8,128 capture=1`

### Phase 3 — admission and platforms
- [x] Paired A/B on tn-web, NVIDIA Turing (medians of 6 pairs). proof: `skinned-crowd.ts ladder=8,32,128,512`, A/A then six stock/projected pairs
  - 128 rigs: frame 10.25 → 7.20 ms, CPU 5.90 → 3.70 ms (6/6 pairs faster).
  - 512 rigs: frame 47.05 → 24.45 ms, CPU 37.0 → 17.75 ms, draws 1026 → 4 (6/6).
  - 8 and 32 rigs: within noise.
  - Recorded in `docs/verification/runtime-perf-state.md`.
- [x] Mesh-floor weight measured, not guessed: a rig counts as 26 rigid draws. The mixed scenes it admits ran faster: 4 rigs + 100 props went 6.2 → 3.85 ms a frame, and 8 rigs + 150 props 9.7 → 6.85 ms. proof: `skinned-crowd.ts ladder=8 props=150` and `ladder=4 props=100`
- [x] Desktop native (Linux, Dawn host `mystral`): `examples/skinned-crowd/playtests/crowd.playtest.json --target desktop` passes with 4 draws for 64 rigs and 0 console errors. Negative control `render.projection: false`: 130 draws, fails. proof: `node packages/playtest/dist/runner/cli.js examples/skinned-crowd/playtests/crowd.playtest.json --target desktop --executable <mystral> --host-arg run --host-arg examples/skinned-crowd/dist/skinned-crowd-native.js`
- [x] Android emulator (`threenative_api35`, x86_64, SwiftShader GPU): the same scenario runs with `skinnedBatches: 1`, `projectedObjects: 64` and 4 draws measured. The draw-count box is refused only because the harness treats a charging emulator as thermally confounded. The one console error is a system Cronet line from another process. proof: the same scenario with `--target android --device emulator-5554`
- [x] Repo gates pass locally, results in the PR. proof: `pnpm typecheck && pnpm lint && pnpm test`

## Acceptance criteria
- [x] Rigs a game wrote as plain `SkinnedMesh` objects draw as one palette draw per pass, with no game code. proof: the Phase 3 desktop scenario
- [x] Poses, slot reuse, retirement and temporal history are correct. proof: `projection-skinned.spec.ts`
- [x] Faster on the frozen paired bench at equal quality, including shadows. proof: the Phase 3 A/B and the Phase 2 captures
- [x] Proven off the web too, on desktop native and the Android emulator; no mobile performance claim. proof: the Phase 3 scenario runs

## Decisions

- **2026-09-25, owner:** integrate into the engine so developers never need to know it exists; prove the performance gains; do not keep optimizing once good enough. This replaced the standalone opt-in example and its admission-only plan. The prototype, its CI workflow and CPU picking were deleted as moot, because the projection keeps the authored scene intact.
- **2026-09-25:** no per-camera culling in the lane. Every pass reads one palette, so shadow casters cannot be dropped by the main view. The earlier box about culling under camera-specific passes is moot.

## Not claimed

These are deliberate limits, not open boxes:
- **GPU velocity image:** not captured. History is proven at the palette, and the shader feeds `positionPrevious`.
- **Browser playtest on this machine:** its bundled Chromium only gets SwiftShader, whose GPU process drops the instance on this scene with the lane on *and* off. Web correctness rests on the hardware captures and specs above.
- **iOS:** not run.
- **Rig transforms:** non-uniform or mirrored rig transforms keep their own draw.

## References

- [Donor research](https://github.com/agargaro/instanced-mesh)
- [Original planning revision](https://github.com/ThreeNativeHQ/threenative/blob/df2f34fe5c000b5df6a65da9c1ff6fbfc028a126/docs/PRDs/threejs-integrations/PRD-threejs-instanced-skinning.md)
- [Charter](../../architecture/CHARTER.md)
