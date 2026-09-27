# PRD-458 — Streamed open worlds hold 60 fps with no per-game tuning

**Status:** PROPOSED — filed 2026-09-27.
**Complexity:** 7 (HIGH): 11+ implementation files, a new clustered-batch system, streaming state across frames. Risk override: none.
**Owner:** engine
**Depends on:** [PRD-459 smooth streaming](PRD-459-smooth-streaming-one-admission-budget-per-frame.md) (per-frame admission budget, prefetch, pipeline prewarm), [PRD-453 per-instance LOD](PRD-453-worldcells-use-existing-lods.md), [PRD-456 distant cell proxies](PRD-456-distant-world-cell-proxies.md), [PRD-457 shadow pages](PRD-457-virtual-shadows-scale-by-measurement.md), and [PRD-377 AutoLOD on by default](../assets/PRD-377-auto-lod-is-on-by-default.md). This PRD owns only what those leave out (below). It does not repeat their work.

## Context

Unreal 5 keeps a dense streamed world at 60 fps without the game tuning anything. GPU Scene uploads only dirty instances. Virtual Shadow Maps re-render only the pages that changed, with instances culled per cluster per page. Nanite and automatic LOD cover foliage, and HLOD merges distant cells and their materials. World Partition streams under a per-frame time budget. ThreeNative is building the same pieces (PRDs 453–457 and 459–461). This PRD closes the gaps the machinefall 2 km map exposed and turns "60 fps by default" into a gated promise.

**Evidence** (machinefall `?scene=map-walk`, RTX 2080 WebGPU, 1600×900, Xvfb + `TN_FRAME_BUDGET`, 2026-09-27). The fixes already landed in #358 took a walk from ~160 ms CPU / 103–130 ms GPU per frame (11.5 s freezes) to ~30 ms CPU / 20–27 ms GPU. What remains is structural:

| Cost (per frame, walking) | Measured | Cause | Owner |
|---|---|---|---|
| Shadow level renders | 0.5–0.8 renders/frame × 510–634 draws, 30–136 ms each (every long task) | Each `SharedBatch` mesh spans all resident cells (`frustumCulled` bounds cover ~240 m), so even the 48 m fine level submits every caster. `castDistance` companions are a game-side stopgap. | **this PRD** |
| Mid-walk node builds | ~133 per 6 s walk, ~1 ms each, clustered inside shadow passes | Streamed keys and caster companions build their shadow-context `NodeBuilder` state on first draw | **this PRD** (shadow context); main context is PRD-459 AC-3 |
| One-level-per-frame shadow scheduling | Reverted: 309 `GPUValidationError: Destroyed texture "ShadowDepthTexture" used in a submit` | three's `Textures.updateTexture` destroys and recreates a level target's depth texture inside a deferred pass while that frame's main-pass bind group still names it | **this PRD** |
| Tree triangles | ~75 M in the main pass before per-cluster culling | AutoLOD rejects every non-`OPAQUE` primitive (`unsupportedMaterial` in `@threenative/assets`); tree needles export as `BLEND`, so 195 models report `material-unsupported` and trees get no chain | **this PRD** |
| Draw count | ~300 renderObject calls/frame at ~75 µs each; 328 materials / 790 geometries | Per-draw binding cost scales with unique material × geometry pairs; the cook never merges materials that became identical. BatchedMesh is not a fix: in three r185 WebGPU it issues one `drawIndexed` per instance (A/B: 18,794 draws, 10.1 ms vs 0.3 ms) | **this PRD** |

Files inspected: `packages/core/src/world-cells.ts`, `world-shared-batch` / `render/mesh-pool.ts`, `world-tiles.ts`, `render/virtual-shadow.ts`, `render/virtual-shadow-pages.ts`, `@threenative/assets` LOD eligibility (`classifyPrimitive`, `unsupportedMaterial`), three r185 `createInstanceMatrixNode`, `RenderObject.getCacheKey`, `Textures.updateTexture`, `WebGPUBackend` BatchedMesh draw.

## Solution

1. **Clustered shared batches.** Each `asset:level:part` shared batch splits its records into spatial clusters (default: world-grid squares of about one cell) with their own bounds. Each cluster is its own InstancedMesh, pooled with a stable uuid so three's node cache holds. Main and shadow level cameras cull clusters through three's normal frustum path, so a 48 m level submits only the clusters it covers. This replaces the `shadows.castDistance` companion stopgap: casting is now bounded by what each level can see, not by a hand-tuned radius. Cluster size is measured, not guessed: pick the smallest size that keeps main-pass draws within 1.3× today's.
2. **Shadow passes schedule safely.** Re-render at most one due level per frame, finest first. Fix the depth-texture lifetime so a deferred level render never destroys a texture the current frame binds: recreate before the bind group is built, or retire it at frame end.
3. **Shadow-context prewarm.** Every streamed key's clusters get their shadow-context node built during admission (behind PRD-459's budget), not on first shadow draw.
4. **Foliage gets automatic LOD.** The cook converts qualifying `BLEND` foliage (alpha from a texture, no true translucency) to alpha-tested with alpha-to-coverage (`renderer.alphaAntialiasing` already exists). AutoLOD accepts `MASK` primitives with a card-preserving reducer: it keeps every primitive and material, reduces cards, and clamps UV and alpha coverage. It does not collapse primitives, which is what lost needle materials in machinefall's earlier LOD1. A level must still save ≥ 20% (`minSaving`); PRD-456 proxies take over beyond the last level.
5. **Materials merge in the cook by default.** `dedupeMaterials` runs by default, and scatter textures that share a shader signature pack into atlas pages, so batches that differed only by texture share one material. `pnpm census:content` reports the before and after.

Consumer flow: a game calls `WorldCells.load({ … })` with no performance options → the cook (`threenative build`) bakes cutout foliage, LOD chains and deduped materials → WorldCells streams clustered batches → the renderer culls clusters per camera and schedules shadow levels → `TN_FRAME_BUDGET` reports the frame.

Risks:
- Clustering multiplies meshes (node builds, draws). Mitigated by pooling, prewarm and the 1.3× main-draw cap.
- Cutout conversion changes the look of soft-edged translucency. Mitigated by eligibility only for texture-alpha materials, plus a per-asset override.
- Atlasing breaks tiling UVs. Mitigated by atlasing only textures whose UVs stay within [0, 1].

## Acceptance Criteria
- [ ] AC-1 [local]: on the world-flythrough fixture, a fine-level (48 m) shadow render submits only clusters that intersect its window: ≤ 150 draws per level render, down from ~614 today. proof: `pnpm vitest run packages/core/__tests__/world-shared-batch-clusters.spec.ts` plus the flythrough pass census — Evidence: pending.
- [ ] AC-2 [local]: world-flythrough renders at most one shadow level per frame and logs 0 console errors, with no `ShadowDepthTexture` destroyed while bound. proof: `node packages/playtest … --scenario world-flythrough` diagnostics `consoleErrors: 0` — Evidence: pending.
- [ ] AC-3 [local]: after warm-up, walking the flythrough records 0 shadow-context node builds attributable to streamed batches or clusters. proof: playtest pipeline census (extends PRD-459 AC-3 to the shadow context) — Evidence: pending.
- [ ] AC-4 [local]: the cook gives a real conifer asset with `BLEND` needles a cutout material and an AutoLOD chain of ≥ 2 levels, each drawing every LOD0 material. proof: `pnpm vitest run packages/assets/__tests__/foliage-lod.spec.ts` on a tree fixture with bark + needle primitives — Evidence: pending.
- [ ] AC-5 [local]: on the world fixture, the cook's default settings reduce distinct materials by ≥ 30% with no visual-baseline regression. proof: `pnpm census:content` before and after, plus the visual baseline capture — Evidence: pending.
- [ ] AC-6 [local]: a freshly scaffolded game that streams a world gets clustered batches, foliage LOD and material dedupe with no `threenative.config.ts` or `WorldCells` performance options. proof: `pnpm vitest run packages/create-threenative/__tests__/scaffold.spec.ts` (new case) — Evidence: pending.
- [ ] AC-7 [local]: the machinefall 2 km map (≈120k placements, authored trees) walked at 5 m/s holds CPU frame p50 ≤ 12 ms, frame p95 ≤ 16.7 ms and max ≤ 33 ms on the RTX 2080 WebGPU adapter, with 0 console errors, with PRD-459 / 453 / 456 / 457 landed and no game-side engine patch. proof: machinefall `pnpm test:scenes` with `performance.maxFrameMsP95: 16.7`, plus the `TN_FRAME_BUDGET` windows — Evidence: pending.
- [ ] AC-8 [local]: the same machinefall run at the 20 m/s fly speed holds frame p95 ≤ 25 ms (a stress bound, not the 60 fps promise). proof: the same scenario with the fly path — Evidence: pending.

## Blocked on
- A display-attached frame-rate check. Xvfb has a ~50 ms swap floor, so AC-7 and AC-8 read CPU/GPU from `TN_FRAME_BUDGET`, not presented fps. A presented-frame run on a real display — unblocked by the owner running the scenario on a desktop session (headed Chromium focused, not occluded).

## Integration Ledger
| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
|---|---|---|---|
| Clustered scatter batches | `WorldCells.load` → `#sharedFor` → cluster meshes, culled by three per camera | Replaces the `shadows.castDistance` companion path. The option is deprecated, then removed once machinefall drops it | AC-1, AC-7 |
| Shadow level scheduling | `VirtualShadowNode.updateBefore` | Replaces "every due level this frame" | AC-2 |
| Shadow-context prewarm | WorldCells admission (PRD-459 budget) | Extends the prewarm gate | AC-3 |
| Foliage cutout + LOD | `threenative build` model pass → `classifyPrimitive` / LOD bake | Lifts the `material-unsupported` rejection for eligible `MASK` | AC-4 |
| Material dedupe/atlas | `threenative build` model pass → `dedupeMaterials` | Becomes a default instead of opt-in | AC-5 |

## Decisions
- 2026-09-27 (owner): 60 fps is required. Do it automatically in the engine, Unreal-5-style, in as few PRDs as possible. Build on PRDs 453–457 / 459–461 instead of duplicating them.
- 2026-09-27 (agent, measured): BatchedMesh is rejected for draw merging (three r185 WebGPU draws per instance). Merge draw count through clusters plus material dedupe instead.

## Execution Phases
#### Phase 1: Shadow submission scales with the window
**Status:** NOT STARTED
**Files:** `packages/core/src/world-cells.ts`, the shared-batch module / `render/mesh-pool.ts`, `render/virtual-shadow.ts`, `render/virtual-shadow-pages.ts`, new `__tests__/world-shared-batch-clusters.spec.ts`.
**Implementation:** Cluster records per shared-batch key, one pooled mesh per cluster with its own bounds. Retire `castDistance` companions. One-level-per-frame scheduling. Fix the depth-texture lifetime. Build the shadow-context prewarm for clusters at admission.
**Verification:** clusters spec plus world-flythrough (pass census, diagnostics, pipeline census). Covers AC-1, AC-2 and AC-3.

#### Phase 2: Foliage and materials cost what they show
**Status:** NOT STARTED
**Files:** `packages/assets` (LOD eligibility, card-preserving reducer, cutout conversion, `dedupeMaterials` default, atlas packing), `packages/create-threenative` scaffold case.
**Implementation:** Eligibility rules for texture-alpha `BLEND` → `MASK`. Add a `MASK` path to AutoLOD that keeps every primitive. Turn dedupe and scatter atlas on by default, with the per-asset override kept.
**Verification:** foliage-lod spec on a real conifer fixture, content census plus visual baseline, and the scaffold spec. Covers AC-4, AC-5 and AC-6.

#### Phase 3: 60 fps on a machinefall-scale world
**Status:** NOT STARTED
**Files:** machinefall `playtests/scenes/map-walk.playtest.json` (walk-speed path plus the 16.7 ms p95 key); drop machinefall's `patches/@threenative+core@*.patch` and the `castDistance` option once a release carries Phases 1–2.
**Implementation:** Pin the release, delete the game patch, run the scenario at 5 m/s and 20 m/s.
**Verification:** machinefall `pnpm test:scenes` plus the `TN_FRAME_BUDGET` windows. Covers AC-7 and AC-8.
