# Three.js constraints, and which ones are ours

**Status:** analysis, 2026-08-02. **Charter authority:** `CHARTER.md` §3 (kill switch),
§5b (never own the look), §10 (15k LOC), §11.1 (20-line rule).

Three.js describes itself as a lightweight general-purpose 3D library, not a game
engine. Every gap below is real. **Not every gap is ours to close** — the second column
is the decision, and "not ours" appears more often than it is comfortable to write.

| Constraint | Ours? | Position |
|---|---|---|
| No game lifecycle, input, save, audio or release architecture | **Yes** | Shipped: `defineGame`, `Scene`, fixed-step loop, `InputMap`, asset loader, state store. This is `CHARTER.md` §3's 42% plumbing surface, and it is the entire product |
| GPU resources need explicit disposal | **Yes, partly** | Entities own `dispose()` in the templates; renderer and input dispose on `game.stop()`. A ref-counted asset handle and leak detector are **not built** — the trigger is a real leak in a real game, not a hypothetical |
| Large scene graphs go CPU-heavy; thousands of `Object3D` nodes cost frame time | **Later** | The separation that enables a fix already exists ([ENTITY-MODEL.md](ENTITY-MODEL.md)). Batching/culling extraction is not built. Trigger: a reference game profiles as scene-graph bound |
| Draw calls and repeated meshes need manual instancing | **No, for now** | `InstancedMesh` and `BatchedMesh` are Three.js primitives a model already knows. Wrapping them costs more code than using them (§11.1). What we *can* own is **measuring** it — see [../product/PERFORMANCE-BUDGETS.md](../product/PERFORMANCE-BUDGETS.md) |
| WebGPU transition is incomplete: `ShaderMaterial` is WebGL-bound, `WebGPURenderer` follows the node path | **Yes, as detection** | We do not migrate shaders or catalogue effects — that is the look, and §5b forbids owning it. We *do* detect and report incompatibilities before a device build (`test --doctor`, ROADMAP Phase 2) |
| Fragmented asset pipeline: compression, dedup, texture conversion, mobile variants | **Not yet** | glTF Transform, Meshopt, KTX2 already exist and are better than anything we would write. See [../product/ASSET-PIPELINE.md](../product/ASSET-PIPELINE.md) for the trigger |
| Browser assumptions leak into Three.js apps (`document`, `HTMLCanvasElement`, `Image`, `fetch`, `TextDecoder`, `requestAnimationFrame`) | **Yes — this is the differentiator** | A certified platform adapter for web and React Native, normalizing canvas, input, audio, haptics, safe areas, pause/resume and asset URLs. Gated on `CHARTER.md` §7 Phase 0a. See [NATIVE-RUNTIME.md](NATIVE-RUNTIME.md) |
| Off-thread Three.js is possible but intricate (RN Worklets, Metro/Babel bundle-mode) | **Yes, if 0a passes** | We own the worker bootstrap, module loading, lifecycle, hot reload, typed message queue and crash recovery. A developer should get a game thread, not a course in RN runtime internals |
| Heavy systems exceed the JS CPU ceiling | **Yes, narrowly** | `@threenative/physics-native`: a JSI binding to Rapier's Rust, with **coarse bulk APIs**, never per-entity bridge calls. `CHARTER.md` §7 |
| Dependency stack moves fast; react-native-webgpu is pre-1.0 | **Yes** | pnpm catalog pins `three: 0.185.1` across every package and example. §9a calls catalogs "load-bearing, not style" because TSL's API churns without a deprecation cycle. A certified matrix and upgrade codemods follow once there is something to upgrade |

## The rule that decides the second column

Three questions, in order. A "no" at any step means it is not ours.

1. **Is it plumbing every game rewrites?** (`CHARTER.md` §3.) If not, stop.
2. **Would it cost more code than vanilla Three.js?** (§3 kill switch, §11.1's 20-line
   rule.) If yes, stop — no matter how much work went into it.
3. **Does a screenshot show it?** (§5b.) If yes, stop. Materials, shaders, TSL, lighting,
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
