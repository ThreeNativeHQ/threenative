# Three.js constraints, and which ones are ours

**Status:** analysis, 2026-08-02; second column re-checked 2026-08-16. The charter wins wherever
this file disagrees with it. The React Native route this file was first written against is
**deleted** — the platform layer is the owned C++ runtime in `packages/runtime-native/`, so rows
that used to say "RN" now say what actually shipped.

Three.js describes itself as a lightweight general-purpose 3D library, not a game
engine. Every gap below is real. **Not every gap is ours to close** — the second column
is the decision, and "not ours" appears more often than it is comfortable to write.

| Constraint | Ours? | Position |
|---|---|---|
| No game lifecycle, input, save, audio or release architecture | **Yes** | Shipped: `defineGame`, `Scene`, fixed-step loop, `InputMap`, asset loader, state store. This is the charter's 42% plumbing surface, and it is the entire product |
| GPU resources need explicit disposal | **Yes, partly** | Entities own `dispose()` in the templates; renderer and input dispose on `game.stop()`. A ref-counted asset handle and leak detector are **not built** — the trigger is a real leak in a real game, not a hypothetical |
| Large scene graphs go CPU-heavy; thousands of `Object3D` nodes cost frame time | **Yes — the trigger fired** | Measured, then built. Three.js's per-object render-list, matrix and culling work is the residual cost on native, not the JS→C++ boundary (~2% of frame). `SceneRenderProjection` in `packages/core/src/renderProjection.ts` mirrors the authored scene and draws never-moving meshes as `InstancedMesh` instances, so thousands of them cost one draw per group while the game's own graph stays untouched. It is invisible to the game — no `userData` flags, no game-side annotation — engages only above a mesh floor, and falls back to rendering the authored scene whenever a faithful mirror is impossible. It supersedes `SceneCollapse`, deleted on 2026-08-21; see [../verification/runtime-perf-state.md#prd-117-android-quickjs-era-record-2026-08-14](../verification/runtime-perf-state.md#prd-117-android-quickjs-era-record-2026-08-14) |
| Draw calls and repeated meshes need manual instancing | **No — measure, and batch what is provably static** | `InstancedMesh` and `BatchedMesh` stay Three.js primitives a model already knows; wrapping them costs more code than using them (the 20-line rule). What the framework owns is the **number** — the render workload advisor in `packages/playtest/src/three/renderWorkloadAdvisor.ts` — and the automatic instancing of geometry the game never moves. See [../product/PERFORMANCE-BUDGETS.md](../product/PERFORMANCE-BUDGETS.md) |
| WebGPU transition is incomplete: `ShaderMaterial` is WebGL-bound, `WebGPURenderer` follows the node path | **Yes, as detection** | We do not migrate shaders or catalogue effects — that is the look, and the framework never owns it. Detecting and reporting incompatibilities before a device build is the intended shape (`test --doctor`, ROADMAP Phase 2) and is **not built** — no `doctor` mode exists in any package today |
| Fragmented asset pipeline: compression, dedup, texture conversion, mobile variants | **Not yet** | glTF Transform, Meshopt, KTX2 already exist and are better than anything we would write. See [../product/ASSET-PIPELINE.md](../product/ASSET-PIPELINE.md) for the trigger |
| Browser assumptions leak into Three.js apps (`document`, `HTMLCanvasElement`, `Image`, `fetch`, `TextDecoder`, `requestAnimationFrame`) | **Yes — this is the differentiator, and it shipped** | The owned runtime shims the browser globals a game reaches for — `canvas`, `input`, `storage`, `http`, `fs`, `audio`, `video`, `workers`, `webgpu` — in `packages/runtime-native/src/`. A global it does not shim breaks native silently, which is why the shim list is the contract. See [NATIVE-RUNTIME.md](NATIVE-RUNTIME.md) |
| Off-thread Three.js is possible but intricate | **Not built** | The runtime shims `workers`, but nothing runs the render loop off-thread on either target, and no measurement has asked for it. The measured native cost is interpreted JavaScript per object, which the scene projection (`SceneRenderProjection`) removes rather than relocates. Reopen this row when a profile names thread contention |
| Heavy systems exceed the JS CPU ceiling | **Yes, narrowly — and it shipped** | Rapier is compiled **into** `packages/runtime-native/` and selected behind the existing `@threenative/physics` package through the `threenative-native` export condition. One versioned bulk typed-array ABI (`step`, `readVisibleTransforms`), never per-entity crossings. No JSI, no WASM on native, and no extra workspace package |
| Dependency stack moves fast; the WebGPU stack is young on every target | **Yes** | pnpm catalog pins `three: 0.185.1` across every package and example, and the native runtime's Three.js compatibility check is exact and fail-closed. The charter calls catalogs "load-bearing, not style" because TSL's API churns without a deprecation cycle. A certified matrix and upgrade codemods follow once there is something to upgrade |

## The rule that decides the second column

Three questions, in order. A "no" at any step means it is not ours.

1. **Is it plumbing every game rewrites?** (the plumbing rule.) If not, stop.
2. **Would it cost more code than vanilla Three.js?** (the kill switch and the 20-line
   rule.) If yes, stop — no matter how much work went into it.
3. **Does a screenshot show it?** (the ownership boundary.) If yes, stop. Materials, shaders, TSL, lighting,
   tonemapping, post-processing composition and camera framing belong in the user's
   `src/render/`, which the scaffold generates as ordinary Three.js source.

Step 3 is the one v1 got backwards. It did not fail to add visual quality — it
**subtracted** it, because the model could only express what the schema allowed.

> An abstraction that cannot express what vanilla expresses makes the output actively
> worse, not just costlier.

## Where measurement replaces abstraction

For most rows above, the honest product is not a wrapper — it is a number.

We do not instance the user's rocks for them. We report:

```
Draw calls   242   ✗ target 180
Suggested:   114 identical rock meshes could be instanced (−113 draw calls)
```

An agent that can see that number makes materially better decisions than an agent that
can only see source files, and the reporting costs a fraction of the abstraction while
leaving the user's visual freedom intact.
