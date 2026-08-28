# Performance bug hunt — 2026-08-27

A four-lane bug hunt for per-frame performance defects OUTSIDE PRD-227's seam scope (op stream and
wrapper shapes are that PRD's; every lane here was fenced off from it, from
`packages/runtime-native/scripts/device-preflight.*`, and from `docs/PRDs/PRD-227*`). Run in the
same tree while the PRD-227 session worked concurrently; all commits are path-limited and the
other session's staged work was never swept.

## What executed

- **Lane 4 (profiles)** — read-only ranking of existing artifacts: `~/projects/threenative/scratch-perf-20260825/bayview.perf.data` (device pre-P1, F13-corrected), `packages/runtime-native/artifacts/prd-227-p2/device-2026-08-27/` (device post-P1: `prd227-p2-upload-shapes-self.csv`, `v8-ic.log`, `js-cpu-profile.log`), `artifacts/prd-222/frame-attribution-2026-08-26/`, `docs/verification/prd-222-reassessment-2026-08-26.md`. Denominator caveat confirmed: no post-P1 device ms/frame capture exists — post-P1 device shares have no ms conversion.
- **Lane 1 (core JS)** — per-frame hot path hunt in `packages/core`, red specs + mutation proofs, desktop node benches.
- **Lane 2 (node ICs)** — IC-log re-analysis, live probe on a real game build (249 frames, real-GPU adapter under the private-Xvfb recipe), dispatch microbench under `node --allow-natives-syntax`.
- **Lane 3 (C++/Rust host)** — read + measured: real-V8-build bench (`/tmp/tn-bench/host_frame_bench.cpp`), call-graph (`/tmp/tn-bench/upload-shapes-cg.txt`), then two implemented fixes with red-green proof.

## Fixes landed (all red-green, mutation named in each commit)

| Commit | Defect | Red → Green |
| --- | --- | --- |
| `17bfd794` | `picking.ts` walked every visited node's parent chain per raycast even with no `exclude` | 841 `Set.has` on a 24-mesh raycast → 0; A/B 12.1–16.3 → 5.4–8.9 ms/raycast at 1,000 meshes (tsx harness, unbundled — warm-JIT saving proportionally smaller) |
| `ba79307f` | `#retireState` swept every state entry per frame but could delete nothing (owners already delete); `specializedLaneReason` walked each renderable's full ancestor chain checking `isLOD`, unreachable in the walk | 1200 retirement lookups vs 1050 bound; 4800 isLOD reads vs 3000 bound → both under bound, suite 479/479 |
| `64eca8f4` | coverage gap: nothing pinned the scan-internal classification to the exported `exactLaneReason` | mutation (drop the geometry/material fallthrough) → test red `'renderOrder' vs undefined`; green on correct code |
| `073cbb14` | native physics `Simulation::step` re-implemented collision events as an O(n²) per-step poll of all body pairs (web uses rapier's event path) | pair-scaling ratio 25.7× → 4.3×; n=128 step 107.7 µs → 6.4 µs; 16.8× faster at 128 bodies; event semantics byte-identical to `simulation.ts:1181`; conformance row `native-physics-collision-events` added (owner PRD-222, `de508691`) |
| `b5021ce5` | canvas 2D compositor uploaded the full surface every frame, no dirty tracking | new `canvas2d_dirty_tracking_test.cpp` compiles red (`hasDirtyPixels` absent) → 24/24 checks; 9 rasterizing ops mark dirty, state/reads never, upload gated on `hasDirtyPixels()`, consume only after a successful write |

Also `62f8f8a0`: invariant pin (below), not a fix.

## Corrected record (evidence against earlier interpretations)

1. **The node-system megamorphic IC population is a load-time compile burst, not per-frame churn.**
   V8 `--log-ic` records state transitions: the node-system sites went megamorphic in one ~5.5 s
   shader-compile burst (671,960 `Node.build()` calls in one frame; **0** per frame in steady state,
   live probe, 249 frames) and stay frozen. Steady per-frame cost is the lookup tax at those sites
   (~0.024 ms/frame) plus ~1.55 ms/frame of node refresh machinery at ~418 draws — which Chrome
   pays too, so it explains none of the native-vs-Chrome gap. PRD-227 P2's "dominant steady-state
   population" line and its 19.7% JS-share bucket (which misattributed `AnimationAction._update` at
   `main.js:33985` to node materials) should be read with this correction. There is no ThreeNative
   mutation target; the 11.77% `(anonymous)@(native)` bucket in `js-cpu-profile.log` IS this
   frozen population (stub cache 8.23% + name dictionary 3.61%, two meters agree).
2. **The clock_gettime hotspot (4.41% of SDLThread cycles post-P1) is an instrument artifact.**
   The profiled device build ran with `TN_ANDROID_JS_PROFILE=1`, which compiles two
   `steady_clock::now()` reads per replayed op and per direct command (`bindings.cpp:5643` et al.),
   ~3,100 vdso reads/frame ≈ 0.7 ms of pure instrument. It tracks op count, not P1. Control: the
   profiling-OFF desktop object has zero hot per-op clock sites. Decisive device control (not run):
   re-profile with `-PthreenativeJsProfile` absent; expect vdso ≤ ~1%.

## Non-findings proven (do not "fix" these)

- **`FrameBudget.endFrame`'s per-frame sample object** allocates in source but never on the heap:
  a GC-observer over 1.2M steady frames collected zero events while a 2M-object probe fires 5 —
  V8 scalar-replaces it because it does not escape `stepFrame`. `62f8f8a0`'s spec pins the
  property; a future closure capture in `endFrame` turns it red.
- Cleared with evidence: `input.tick` (reused buffers, zero allocs), `scheduler.tick`,
  state store (coalesced, 100 ms flush), `Registry.sweep`, `TracerPool3D.update`,
  `GPUParticles3D.process`, viewport, canvas-layer, loop `stepFrame`, physics plugin update
  (bulk typed arrays; per-body `translation()`/`rotation()` allocs are rapier 0.19.3's documented
  no-out-param constraint), idle pump drains (110 ns/frame), staging uploads (already pooled).

## Parked candidates (not built, by design)

- **Scene-level broadphase/bounds pre-test before per-mesh BVH queries** — per-raycast cost is
  O(scene) with a ~2.6 µs/mesh constant; 2.65 ms p50 at 1,000 meshes. The framework never
  raycasts on its own; a broadphase is a design decision and needs a PRD. Games should pass
  `targets` subsets today.
- **Game-owned (sandbox fps-framework): 224 pooled decal materials** with `frustumCulled=false`
  (~54% of draws) — one instanced draw is worth ~0.5–0.8 ms/frame. Belongs to the game.
- **Templates gate per-template-continue mode** — the gate aborts at the first failing template,
  so `starter` was never exercised in any run this session.

## Gate status (what ran, what did not)

- Core suite: 479/479 at `ba79307f`; classification spec 3/3 after `64eca8f4`.
- `pnpm test:playtest`: **green** — 4/4 scenarios (movement, camera, movement-axis,
  navigation-routes-around-blocker) after rebuilding core dist; the first run's
  `TN_PLAYTEST_BRIDGE_MISSING` failure was the stale-dist trap (game bundles take playtest code
  from core's dist — rebuild core or the change silently vanishes).
- `pnpm test:templates`: action-rpg, defense, minimal, platformer, racing **green**; shooter red
  on `production-performance` with a deterministic `TN_CAPTURE_BLANK` (brightness 0.01987,
  byte-identical across runs) while every functional assertion passes — capture-lane, not a
  gameplay regression: the render/capture path is byte-identical `e0409202..HEAD` outside
  classification-preserving core edits (closure by mechanism; the gate was NOT replayed at
  `e0409202`). Prior art: `982d6913`. Starter: never exercised.
- Full monorepo `typecheck && lint && test`: typecheck **green** across all 16 workspace projects
  (the first run caught a real typecheck error in the new spec — `this.isMesh` on `Object3D`,
  fixed in `7849f44f`; vitest does not typecheck, the full gate does). `pnpm lint` is **red on
  main independently of this session**: 11 pre-existing
  `lint/complexity/noExcessiveCognitiveComplexity` errors in `examples/abyss-framework/src/`
  (`replay-proof.ts` complexity 22, `Abyss.ts` 42, others), files untouched for days and unchanged
  in this session's commits — left to their owner, not refactored out of scope. The session's own
  files are biome-clean. `pnpm test`: **573 passed / 4 failed** — one failure was this session's
  (`b5021ce5` declared the canvas test target but missed the contract-lane count bump and its
  execution contract; fixed in `08e7f393`, test now 5/5), three are other sessions' commits and
  were not repaired from this lane: `android-js-engine-native-profiling` (vsync regex vs
  `b3dc53d2`'s runtime.cpp change), `lifecycle-pause` (same commit), and `device-preflight`
  (PRD-225's `7294660b` added an install lane without the suppress call the preflight gate walks
  for).
- Not run this session: device lane (PRD-227 Phase 3 owns it; no post-P1 device ms/frame capture
  was taken), `pnpm native:verify:desktop` (300-frame desktop proof — lane 3 rebuilt the physics
  artifact and ran its contract tests, but the full desktop frame proof was not re-run),
  cross-engine QuickJS/JSC lanes (PRD-227's open criterion).

Every number above names its artifact; anything not run is named as not run.
