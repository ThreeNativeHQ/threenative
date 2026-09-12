---
prd_contract: v1
---

# PRD-377 — One source model gets the right detail by default

## TL;DR

A developer authors one GLB and loads it through ThreeNative's normal asset path. ThreeNative generates useful lower-detail geometry during the existing asset compile/cook, then selects detail automatically from projected geometric error. No hand-authored LOD files, special loader, or game-owned update loop is required. **Automatic LOD is on by default for eligible assets; `threenative.config.ts` is its source of truth and provides a complete opt-out.**

This is not a greenfield LOD renderer. The repository already has default-on virtual geometry for sufficiently dense primitives. Extend and reconcile that machinery, adding a conservative discrete-LOD path where it supplies missing value. Exactly one system owns detail selection for a primitive. Preserve the original source, the full-detail fallback, materials, object identity, and gameplay semantics.

**Status:** NOT STARTED — implementation not started; this document does not enable or qualify any feature.
**Date:** 2026-09-11.
**Scope:** Asset compilation, configuration, ordinary model loading, and existing render integration.
**Complexity:** HIGH — default-on lossy processing crosses build, runtime, and platform boundaries.

## Closure Gates

Every box below requires evidence from the implementation revision. Merging this PRD completes none of them.

- [ ] **Zero-configuration front door:** an ordinary created project with one eligible GLB and no LOD settings generates and renders lower detail through normal `tn dev` / `tn build` and normal model loading. No custom game loop, private import, or manually prepared LOD input is involved.
- [ ] **Config actually controls execution:** omission, global off, presets, partial settings, and per-asset overrides are typed, validated, serialized, and consumed by both compiler and runtime. Existing explicit opt-outs remain effective.
- [ ] **One owner, not two optimizers:** authored LOD, `TN_virtual_geometry`, explicit legacy simplification, and new discrete LOD have tested precedence. No primitive is automatically simplified or selected twice.
- [ ] **Quality and correctness:** approved eligible fixtures pass structural checks and rendered comparisons at switch boundaries; excluded fixtures retain their baseline rendering and gameplay behavior. Error estimates are never represented as universal perceptual guarantees.
- [ ] **Measured value:** a representative dense static asset achieves at least 50% fewer submitted triangles on the declared far-camera route without unacceptable image or frame-time regression. Record actual draws, CPU/GPU time, startup cost, and storage/residency overhead—not triangles alone.
- [ ] **Lifecycle and failure safety:** deterministic cache behavior, invalidation, hot reload, instancing, multi-view/shadow behavior, resource ownership, and corrupt/missing metadata have positive and negative tests through real entry points.
- [ ] **Portable release evidence:** browser WebGPU and owned native desktop run the same consumer; each mobile target enabled by default has its own render/correctness evidence. Unmeasured hardware or software-renderer timing is not counted as mobile performance proof.
- [ ] **Discoverable and reversible:** configuration reference, generated-project guidance, capability discovery, and diagnostics explain the effective behavior. Disabling AutoLOD removes its generation and runtime work without disabling unrelated asset optimizations.

## 1. Problem and repository grounding

The desired authoring contract is **one source model, automatic useful detail, optional central configuration**. `THREE.LOD` selects supplied objects; it does not generate simplified versions. Lower triangle count also does not inherently lower draw count, texture cost, download size, or total frame time.

The repository is further along than that starting point:

| Existing surface | What this PRD must respect |
| --- | --- |
| [PRD-098](../done/PRD-098-lod-and-instancing.md) | The earlier discrete LOD/instancing proposal was **declined**, not implemented, after its contemporary workload census found no triangle-bound scene. This PRD reopens the one-source/default-on authoring requirement, not its unmeasured performance claims. |
| [Virtual-geometry batch](../done/nanite-like/README.md) | Documents default-on cluster baking above 65,536 triangles per primitive, `assets.models.virtual`, `TN_virtual_geometry`, `ClusteredMesh`, `ClusteredBatch`, and engine-driven selection. It also records a historical native draw-count regression and unverified mobile coverage. Those are historical evidence, not a fresh benchmark of today's revision. |
| [`model.ts`](../../../packages/assets/src/passes/model.ts) | Already imports glTF Transform and `MeshoptSimplifier`, exposes opt-in single-ratio `simplify`, and defaults `virtual` baking on when that option is absent. Single-ratio simplification is not an automatically selected LOD chain. |
| [Default-on cook](../done/PRD-349-the-cook-is-on-by-default.md) | Existing commands, source preservation, caching, and cook opt-outs are the integration point. Direct GLB processing must not acquire a Blender dependency. |
| [Compression quality floor](./PRD-351-compression-never-looks-worse-than-a-floor.md) | Reuse applicable comparison/reporting instruments; independently account for geometry approximation and texture/quantization changes. Do not claim that satisfying a geometric-error target satisfies every material's visual requirements. |
| [Starter configuration](../../../packages/create-threenative/templates/starter/threenative.config.ts) | Uses the existing exported `ThreeNativeConfig` from `@threenative/playtest`. Extend that surface; do not introduce a second `defineConfig`, speculative `loadGLB` API, or a separate optimization configuration file. |

Before implementation, trace the current config-to-compile-to-loader-to-render chain. Record actual call sites and current virtual-geometry behavior on the target revision. Reuse working components; repair a missing connection instead of replacing an incumbent with a parallel mechanism.

## 2. Outcomes and non-goals

**Required:** default-on eligible processing, safe discrete representations for assets not already owned by another LOD mechanism, central configuration, screen-space selection, deterministic cooked artifacts, conservative fallback, and measured web/native delivery.

**Not required for v1:** a new cluster renderer, GPU-driven selection, streaming, impostors, automatic material atlasing, material-count reduction, cross-fades, bone/animation LOD, deforming-mesh simplification, or independently coarser shadow meshes. Existing virtual geometry remains supported; these exclusions are not instructions to remove it.

Do not turn this into a general instancing or HLOD project. Preserve existing batching and instancing, and report any trade-off. A result that saves triangles but regresses total frame time is not a demonstrated optimization.

## 3. Configuration contract

### 3.1 One author-facing policy

Add **`assets.lod`** to `threenative.config.ts`, using the existing config type, validation, and build/runtime handoff. This is a **proposed extension**, not a claim that the following fields exist today. The block below is an excerpt to merge into an otherwise unchanged project config:

```ts
assets: {
  lod: {
    enabled: true,
    preset: 'balanced',
    generation: {
      maxLevels: 4,
      minTriangles: 5_000,
    },
    runtime: {
      maxPixelError: 1,
      hysteresis: 0.15,
    },
    overrides: {
      'models/hero.glb': false,
      'models/castle.glb': { preset: 'quality' },
    },
  },
}
```

`assets.lod: false` and `assets.lod: { enabled: false }` are equivalent global kill switches for **ThreeNative-managed automatic** LOD, including implicit virtual-geometry activation. They do not disable an explicitly game-authored `THREE.LOD` or mutate source files. Omitting `assets.lod`, or writing `{}`, resolves to enabled/balanced once the implementation passes its release gates. No setting in a starter file is required to activate the feature.

Keep overrides in this same config. V1 accepts exact canonical project-relative source asset keys, using `/` separators and the existing asset resolver; no glob precedence or per-load generation settings. A runtime URL such as `/models/hero.glb` must resolve back to its registered source key rather than be matched as a different asset. Unknown override keys are diagnosed during asset discovery. The example keys represent source identifiers, not a new URL convention.

### 3.2 Defaults, merge rules, and validation

| Setting | Initial contract |
| --- | --- |
| `preset` | `quality`, `balanced`, or `aggressive`; default `balanced`. |
| `generation.maxLevels` | Default 4 **including LOD0**, integer 1–8; applies to discrete LOD, not the existing cluster DAG's depth. `1` emits no derived discrete levels. |
| `generation.minTriangles` | Default 5,000 per eligible primitive, not per entire GLB; positive integer. Eligibility and measured benefit may still cause a skip. |
| `runtime.maxPixelError` | Positive finite projected geometric-error budget in actual raster pixels. Initial preset defaults: quality 0.5, balanced 1.0, aggressive 2.0. These are policy starting points, not measured guarantees. |
| `runtime.hysteresis` | Default 0.15, finite value in `[0, 0.5)`; stabilizes coarsening without postponing required refinement. |

Resolve the effective preset from asset override, then project, then default. Expand its defaults once; overlay explicit project fields, then explicit asset fields. Overrides are partial, not replacements for whole nested objects. A global `false` is absolute and cannot be re-enabled by a per-asset override; an asset `false` always disables automatic work for that asset. Validate the resolved policy before any bake. Unknown fields, non-finite numbers, invalid enums, and out-of-range values name their config path and fail instead of silently falling back.

V1 presets primarily set the screen-error budget; generation defaults above are shared. Do not expose arbitrary percentage ladders or invent hidden, unmeasured preset differences. Explicit numeric settings win over preset defaults. Generation and runtime settings have separate cache fingerprints: changing only pixel budget/hysteresis refreshes runtime metadata/config, not geometry generation.

### 3.3 Existing settings and cook boundaries

Translate legacy settings into the same effective policy, rather than running old and new paths independently. Preserve explicit `assets.models.virtual: 'none'`: with no new explicit LOD policy for that asset, it must not quietly become default-on discrete LOD. Preserve explicit legacy single-ratio `simplify`; such assets skip additional automatic generation with an `explicit-legacy-simplify` reason. An explicit new declaration conflicting with a legacy declaration must produce a migration diagnostic, not silently choose a winner. The implementation must document and test the exact existing config shapes, including projects that use a model list instead of model-pass options.

Existing all-cook and per-mode cook opt-outs retain their meaning: no hidden generation outside the disabled cook/compile path. Already cooked LOD artifacts can still be rendered when runtime LOD is enabled; uncooked files use full detail and report that no generated representation is available. `assets.lod: false` additionally prevents automatic LOD activation even when such metadata is present. Do not disable compression, textures, or unrelated cook passes as a side effect of this setting.

## 4. Eligibility and generation

### 4.1 Conservative eligibility

Start with static, indexed triangle primitives with finite positions, valid indices and bounds, supported opaque materials, and supported immutable attributes. Lossless indexing is permitted for suitable non-indexed input. Rigid node transforms are supported; skinning and vertex deformation are not.

Skip—with a stable reason code—small/unprofitable meshes; skinned, morph-target, or dynamically deformed geometry; alpha-blended/masked or transmission-sensitive materials; displacement or custom vertex behavior without a validated contract; lines/points; unsupported attributes/topology; and explicitly authored LOD. Runtime material/geometry replacement that invalidates eligibility must restore the baseline or require an explicit opt-out; do not silently keep applying stale error metadata.

Preserve UV seams, hard-normal discontinuities, tangent/normal-map behavior, vertex colors, material boundaries, and lightmap UVs. Multi-primitive assets keep their node structure and materials. Where independent simplification can open a shared boundary, lock that boundary or decline the affected unit. No merging of different materials, surfaces, or animated nodes merely to reach a triangle target.

An inability to reduce safely/usefully is a normal skip, not a mandate to force a ratio. Passing structural checks and a simplifier error threshold is necessary, but not proof that an arbitrary material looks unchanged from every view.

### 4.2 A single owner per primitive

Use this decision order: explicit opt-out or authored ownership; existing supported virtual-geometry representation; eligible new discrete generation; otherwise baseline geometry. Never wrap `ClusteredMesh` in an additional automatic discrete LOD controller or process an already cooked chain as fresh source.

For newly cooked dense inputs, compare the incumbent clustered strategy against discrete/full-detail on representative browser and native workloads before changing the existing routing policy. Keep that choice deterministic and recorded in metadata. Do not build two payload families by default or dynamically switch algorithms every frame. An unqualified strategy retains the tested baseline and an explicit diagnostic on that target; missing mobile evidence does not become a silent “supported” claim.

### 4.3 Error-driven, bounded offline work

Use the already available meshoptimizer/glTF Transform integration, not a new simplifier dependency. Derive each discrete level from the same LOD0 reference, or conservatively accumulate and validate error if using a successive chain. Store actual achieved counts and actual error relative to that reference. Preserve an unsimplified LOD0 relative to the existing non-AutoLOD cook result; never overwrite the authored GLB.

Choose versioned increasing geometric-error targets and stop when simplification stalls, quality checks fail, or the level/storage budget is reached. Do not force `100% / 50% / 20% / 5%`. Initially reject a derived level saving less than 20% of its predecessor's triangles. `maxLevels` is a ceiling, not a promise to create redundant geometry. Drop rejected levels and maintain monotonic usable error/count ordering, including an explicitly handled zero-error level.

Report normalized simplifier error and the scale used to convert it to local-space absolute error. Attribute-weighted error must not be mislabeled as a pure position bound. Include downstream quantization effects in the reported budget or measure against the decoded baseline; do not lose units between the baker and runtime.

Generation runs only in the existing build/import/dev-cook environment, with bounded concurrency, memory, attempts, and output size. Reuse its worker scheduling, instrumentation, and cancellation. Independent assets may cook in parallel; dependent passes and level publication remain ordered. No simplifier/WASM compilation or progressive decimation is added to the player's first frame or render loop.

## 5. Artifact and loading contract

The default discrete output is **one cooked GLB**, not several independently authored or duplicated model files. Keep LOD0 as its ordinary scene representation. Store derived mesh/index references and a versioned optional LOD extension alongside it; reuse existing extension registration/validation patterns. A generic glTF reader ignoring the extension must render only LOD0, not every level simultaneously. ThreeNative's loader must explicitly consume the metadata—custom glTF data does not magically become a `THREE.LOD`.

Share immutable attribute accessors, materials, images, and texture resources where valid. An index-only simplifier can reference existing vertices; methods that move vertices or reconstruct attributes cannot claim that sharing. Reorder/remap all affected buffers coherently. Preserve native-compatible vertex layouts. Validate both written and decoded artifacts, including references, bounds, index ranges, counts, and extension version.

Record at least source/content identity, generator/schema versions, generation fingerprint, per-primitive strategy and baseline mapping, local bounds, actual per-level counts/errors, shared-buffer ownership, and byte overhead. Runtime policy travels through the normal resolved project configuration; serialize only data, not executable config functions.

One authored GLB does **not** mean zero extra geometry, reduced download, or independently streamable levels. V1 can load the full cooked GLB. Report compressed file bytes, decoded CPU bytes, resident GPU bytes, and cook peak memory separately. Never copy textures per level or silently switch to runtime generation to meet a packaging target.

Cache keys include source/dependency bytes, effective generation policy, algorithm/toolchain version, and output schema. Builds are deterministic under the pinned toolchain; hot reload publishes a complete validated replacement atomically. Generated output is not rediscovered as input, and changing one source does not rebake unrelated assets.

## 6. Runtime selection and safety

Reuse the existing normal model-loading and pre-render integration. Register eligible renderables once and remove them on disposal. If `THREE.LOD` supplies object switching, disable its independent distance auto-update for managed objects. There is exactly one selection authority.

Select the cheapest available level satisfying the projected geometric-error estimate. Convert local error to world error using a conservative transform bound, including non-uniform scale and parent shear. Use the camera projection, zoom, actual render viewport, and conservative nearest relevant view-space depth—not distance to the object origin alone. Handle orthographic cameras separately. Near-plane intersection, invalid bounds/projection, or a camera inside relevant bounds selects full detail conservatively.

For a simple perspective illustration only:

```text
estimated pixel error ~= world-space error * viewport height
                         / (2 * conservative depth * tan(vertical FOV / 2))
```

The implementation must derive projection-correct behavior for supported camera modes; this illustration is not a rigorous all-views displacement bound. Account for viewport/render-resolution changes and avoid LOD/resolution controllers feeding oscillations into one another.

Refine immediately when the selected level exceeds budget. Coarsen only when the proposed cheaper level falls below `(1 - hysteresis) * budget`. This stabilizes thresholds without letting hysteresis authorize an indefinitely over-budget coarse level. Handle zero-error levels explicitly; do not require LOD0 at every close view when a derived representation is truly equivalent under the recorded metric.

Multiple cameras, stereo views, reflection captures, and shadows must not reuse a stale choice from another pass. Choose the finest detail required by all relevant views, or use a proven pass-local selection mechanism. V1 does **not** automatically request an even coarser shadow LOD: retain LOD0 for shadows or prove a conservative shared choice. Main-camera invisibility does not remove an off-screen shadow caster.

Keep entity/node identity, names, transforms, materials, event mappings, authored visibility, and render order intact. Physics, collision, navigation, and default precision picking continue using baseline/source semantics, not camera-dependent render geometry. Document raw Three.js face-index behavior; stable framework picking must not depend on the selected render LOD.

Instances sharing an asset may need different detail. Do not mutate a shared geometry/index so that one instance changes every other instance, and do not silently de-instance a large batch into hundreds of draws. Reuse safe existing batches; otherwise decline that optimization and report the reason. Preserve shared resource lifetimes: disposing one instance or geometry must not destroy a sibling's attributes. Test unload, reload, scene restart, and device-resource recreation where supported.

The ordinary frame performs no simplification, per-frame hierarchy discovery, new geometry allocation, synchronous GPU readback, or unnecessary buffer re-upload. Cache reusable state and upload only what the selected strategy actually changes. Assets without an eligible cooked representation, and explicitly disabled assets, install no automatic LOD controller; omitting configuration alone does not disable it.

## 7. Diagnostics and failures

Extend existing cook reports, asset diagnostics, and performance instruments rather than adding a parallel dashboard. Report effective config and its origin; selected strategy; generated/used levels; reasons for skipped or baseline-only assets; source versus submitted triangles and actual draws; bake/cache cost; file/residency overhead; and target qualification.

Distinguish expected skip, disabled policy, unsupported input, and tool/artifact failure. Invalid config, a failed compiler invariant, or a malformed newly generated artifact fails the build with the asset and stage named. Do not hide a broken compiler behind “ineligible.” Missing optional LOD data on a valid older/raw GLB may use LOD0 with diagnostics. Runtime recovery from malformed optional data may retain intact LOD0, but emits an actionable error and fails the corresponding validation test. Invalid baseline geometry remains the existing asset-load error, not a fake successful placeholder.

Useful stable reasons include `disabled`, `too-small`, `insufficient-reduction`, `authored-lod`, `virtual-owned`, `explicit-legacy-simplify`, `deforming`, `material-unsupported`, `boundary-unsafe`, `instance-policy-unsupported`, and `uncooked`. Diagnostic text and capability discovery must describe skipped/unqualified paths truthfully.

## 8. Implementation sequence and verification

Each phase extends the real caller chain and carries its own focused tests. Parallelize independent fixture, config, and documentation work after the metadata contract is settled; do not duplicate verification at every layer.

| Phase | Deliverable and proof |
| --- | --- |
| 0 — trace and baseline | Identify actual config/compile/load/render owners; inventory legacy opt-outs; reuse a real dense asset and the quarry where applicable. Record baseline image, triangles, draws, bytes, and CPU/GPU timing on declared targets. No new renderer before this audit. |
| 1 — config and artifact | Add typed/resolved policy, deterministic eligibility and offline generation, optional-extension round trip, source preservation, cache/invalidation, and resource metadata. Tests enter through the public compiler/config loader, not only a private simplifier helper. |
| 2 — ordinary runtime | Wire normal model loading and engine-owned selection; test camera/projection/scale changes, views/shadows, picking, instances, opt-out, and lifetime behavior on real decoded artifacts. |
| 3 — consumer qualification | Run an ordinary generated project through normal dev/build/loading paths on browser and native, capture visual comparisons around transitions, and measure frame-time and startup/storage impact. Enable each target only with its evidence. |
| 4 — default and discovery | Make omission resolve to enabled only after qualification; document migration and escape hatches through existing config/scaffold/discovery surfaces, then rerun the zero-config and off-path consumer proof. |

### Phase progress checklists

Keep these boxes current in the implementation PR. They remain open in this specification-only PR.

#### Phase 0 — trace and baseline

- [ ] The current config-to-render caller chain and legacy settings are mapped.
- [ ] The representative corpus has reproducible baseline measurements.

#### Phase 1 — config and artifact

- [ ] Public config resolution passes the precedence and invalid-input tests.
- [ ] The normal compiler applies tested eligibility and error-driven generation.
- [ ] Cooked GLBs pass extension round-trip and baseline-preservation tests.
- [ ] Cache invalidation and atomic hot reload pass their integration tests.

#### Phase 2 — ordinary runtime

- [ ] Normal model loading reaches the single engine-owned LOD controller.
- [ ] Projection and hysteresis tests pass on decoded assets.
- [ ] Multi-view and shadow correctness tests pass.
- [ ] Gameplay identity and precision-picking tests pass.
- [ ] Instance isolation and shared-resource lifetime tests pass.

#### Phase 3 — consumer qualification

- [ ] Browser WebGPU consumer evidence establishes the default policy.
- [ ] Windows native consumer evidence establishes the default policy.
- [ ] macOS native consumer evidence establishes the default policy.
- [ ] Linux native consumer evidence establishes the default policy.
- [ ] Android's policy is backed by target evidence or explicitly remains baseline-only.
- [ ] iOS's policy is backed by target evidence or explicitly remains baseline-only.
- [ ] The dense-asset triangle-reduction gate passes.
- [ ] The frame-time regression gates pass on every default-enabled target.
- [ ] The rendered-quality gate passes on the declared corpus.
- [ ] The new discrete-artifact byte budgets pass.

#### Phase 4 — default and discovery

- [ ] Omitted configuration enables the qualified policy through the real front door.
- [ ] The global off switch passes its end-to-end negative control.
- [ ] Existing config documentation and discovery expose the effective settings.
- [ ] Generated-project guidance documents default behavior and migration.

### Minimum acceptance matrix

| Case | Observable assertion / negative control |
| --- | --- |
| Omitted config vs explicit off | Same authored source; eligible default produces and uses derived detail. Off produces no automatic payload or runtime controller. Forcing LOD0 removes the measured triangle benefit. |
| Presets and partial overrides | Resolved numeric settings have tested precedence; an asset opt-out remains off; unknown keys/invalid values fail by config path. A runtime-only edit does not invoke the simplifier. |
| Legacy and existing LOD | Explicit old opt-outs keep working; manual LOD and virtual-owned primitives have one owner; conflicting explicit policies diagnose rather than stack. |
| Eligible static textured asset | LOD0 matches the non-AutoLOD cooked reference; lower levels preserve UV/material/node semantics and reduce submitted work on the prescribed camera route. |
| Risky content corpus | Skin/morph/deformation, alpha mask/blend, lightmap/seam fixtures, tiny meshes, and unsupported topology either retain baseline or meet their explicitly qualified contract. No lost pieces or new boundary cracks. |
| Camera transitions | Perspective/orthographic zoom, actual pixel resize, scaled parents, near-plane/inside bounds, rapid camera motion, and boundary oscillation select valid levels with no stale view choice. |
| Multi-view and gameplay | Two views and shadow-only casters remain correct; collisions and framework picking return the same target before/after camera-driven switches. |
| Instances and lifecycle | Independent instances select correctly without draw explosion; repeated load/unload/reload returns tracked resources to baseline and never invalidates live siblings. |
| Cache and corruption | Repeat cook is identical and cached; source/generator changes invalidate; malformed extension/index/error data is detected; raw valid GLB still renders baseline. |
| Real front door | Remove the new compile or runtime connection and the relevant consumer assertion fails. New integration tests through real entry points are valid proof; no artificial requirement that a pre-existing test already cover this new behavior. |

Use a declared representative corpus and deterministic camera routes, including a real textured dense model, not just a generated sphere. For the dense benefit fixture, require at least 50% fewer far-route submitted triangles. Report median and p95 CPU/render/GPU measurements separately with hardware/backend, resolution, warmup, sample count, and variance. Predeclare a regression allowance of 5% for median/p95 total frame time on each representative route and the ineligible/disabled control; investigate measurement uncertainty instead of passing noisy numbers. No default-on strategy is approved on a target when its repeated measurements show a regression beyond that allowance.

Compare matched cameras and lighting at LOD0, each transition, close silhouettes, and the far route. Review per-object silhouette/UV/normal-map artifacts in addition to aggregate image metrics. Reuse an existing meaningful image-quality floor or establish and justify one before evaluating the candidate; do not tune it after observing failures. A one-pixel geometric budget is not automatically a one-pixel image difference.

Start with a 1.5x cap on decoded geometry bytes and cooked file bytes versus the non-AutoLOD result for **new discrete** artifacts; reject lower-value levels until within the cap or keep LOD0. Treat this as an explicit initial product budget, not a prediction; report unavoidable overhead, especially for tiny files. Existing clustered assets retain their own measured/storage contract and are not claimed to fit this discrete budget. Report cold bake, warm-cache, load-to-first-frame, and peak memory even where no speedup is expected.

Browser/native compatibility and mobile render correctness are separate from hardware performance qualification. CI/software rendering can prove functional behavior but cannot certify a physical phone's frame-time budget. Retain honest target-specific qualification until the necessary evidence exists.

## 9. Completion boundary and references

The implementation is complete only when the closure gates have revision-linked evidence and normal consumers get the intended behavior. Unprofitable or unsupported assets may correctly remain full detail; “skip everything” does not satisfy the positive eligible-asset gate. Do not mark this PRD done because a helper emits fewer indices or because the specification itself merged.

Primary technical references for implementation review:

- [Three.js LOD](https://threejs.org/docs/pages/LOD.html): supplied-level selection and auto-update behavior.
- [meshoptimizer JavaScript API](https://github.com/zeux/meshoptimizer/blob/master/js/README.md): simplification, error scale, indices, and buffer semantics; use the repository's pinned implementation when validating exact behavior.
- [glTF Transform simplify](https://gltf-transform.dev/modules/functions/functions/simplify): target ratios are constrained by error and topology; simplification alone does not wire a runtime LOD system.

This PR changes this PRD only. No runtime/config defaults, source assets, generated artifacts, package versions, workflow checks, or previous PRD statuses are changed by its merge.
