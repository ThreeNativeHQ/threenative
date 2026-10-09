---
prd_contract: v1
---

# PRD-572 — Shadow casters sort themselves into static and moving

**Status:** IN PROGRESS
**Priority:** P2 — AC-1 is open: a caster that moves without a `trackCaster` call keeps a stale shadow in the cached levels until the camera moves a level window.
**Complexity:** 3 (LOW) — 1–5 engine files (1): `render/virtual-shadow.ts`; complex state (+2): a per-caster classification that changes over frames. Risk override: none.
**Owner:** João
**Depends on:** None. Sits beside [PRD-457](../rendering/PRD-457-virtual-shadows-scale-by-measurement.md) (which names this gap and leaves it out of scope) and [PRD-538](../open-world/PRD-538-shadow-maps-redraw-only-what-streamed-in.md) (region redraws, which this PRD uses for its transitions).

## Context

`VirtualShadowNode` (`packages/core/src/render/virtual-shadow.ts`) keeps camera-centred clip
levels cached until their window moves. Moving objects are kept out of that cache by hand:

- The game calls `trackCaster(object)` (`virtual-shadow.ts:1110-1121`). That enables
  `VIRTUAL_SHADOW_MOVER_LAYER` (layer 29, `:369`) on the object and its children, so each level's
  mover camera draws it into a small per-level mover map every frame. The fragment takes the darker
  of the cached map and the mover map (`:707-711`).
- The docblock requires it: "call `trackCaster(object)` for movers" (`:735`), and the starter
  `AGENTS.md` repeats it (`packages/create-threenative/templates/starter/AGENTS.md:79`).
- `trackCaster` and `untrackCaster` call `invalidateAll()` (`:1119`, `:1130`), which redraws every
  level for one object.

Nothing outside the proof harness calls it. The only callers in the repo are
`packages/core/scripts/vsm-proof/proof.ts:121` and the unit specs. The reference consumer,
`examples/abyss-framework/src/scenes/WorldProbe.ts:116`, installs the node and tracks nothing.

The failure: a caster that moves while the camera holds still is baked into a cached level at its
old position. Its shadow stays there until that level's window moves. A cold agent does not know
the call exists, and the auto-by-default rule says the engine should decide what it can measure.
Movement is measurable: a world matrix changed, an instance matrix buffer changed, or a mesh
deforms.

### What Unreal does (UE 5.8.3, read 2026-10-09)

- **Any invalidation makes a caster dynamic.** When a primitive invalidates its shadow pages, the
  cache manager marks it dynamic and records the frame number
  (`Engine/Source/Runtime/Renderer/Private/VirtualShadowMaps/VirtualShadowMapCacheManager.cpp:1767-1782`).
- **It returns to static after a quiet period.** `r.Shadow.Virtual.Cache.FramesStaticThreshold`
  defaults to 100 frames (`VirtualShadowMapCacheManager.cpp:142-146`). Each frame, a dynamic
  primitive whose last invalidation is older than that wants static (`:1797-1810`).
- **The transition back to static redraws only that primitive's pages.** UE adds an invalidation
  for that primitive for every light, with a force-static flag, so its shadow moves into the
  static cache once (`VirtualShadowMapCacheManager.cpp:1811-1832`). It does not redraw the whole map.
- **A removed primitive resets.** Its dynamic flag clears and its last-invalidation frame becomes
  "unknown" (`VirtualShadowMapCacheManager.cpp:1784-1793`).

## Solution

The node classifies its own casters each frame in `updateBefore` (`virtual-shadow.ts:2229`), after
three has updated world matrices for the frame:

1. **Measure movement exactly.** For each shadow-casting object on layer 0, compare against the
   value stored at the last frame: the 16 world-matrix elements for a `Mesh`, and
   `instanceMatrix.version` for an `InstancedMesh`. A deforming caster (`SkinnedMesh`, or a mesh
   with active morph targets) counts as moving every frame it is visible, as UE treats deforming
   primitives.
2. **Moving → mover.** A caster that moved and is not a mover yet gets the mover layer, the same
   state `trackCaster` sets. The cached levels redraw only the region of its **old** bounds
   (`invalidateRegion`, `:1152`), so the stale baked shadow goes away. The levels do not
   redraw in full.
3. **Quiet → static.** A mover with no movement for `staticAfterFrames` frames (default 100, UE's
   value) leaves the mover layer, and its **current** bounds region redraws once, so its shadow
   enters the cache.
4. **Overrides.** `trackCaster(object)` stays and pins the object as a mover, so it never returns
   to static. A new `pinStatic(object)` opts an object out of detection. `staticAfterFrames` is a
   node option. Reports: `TN_VIRTUAL_SHADOW` gains `autoMovers` and `autoTransitions`.
5. **Out of scope.** GPU-scene keys and world-cell batches already invalidate through PRD-538's
   region path, so this PRD does not scan them.

This is measurement, not a guess. `packages/core/src/static-transform.ts:15-21` forbids guessing
staticness from "not moved in 60 frames", because a wrong guess there drops a transform update.
Here a wrong guess costs one region redraw, never a stale shadow. Movement is detected again on
the next frame it happens, and the caster becomes a mover again in that same frame.

Risk: the scan is O(shadow casters) every frame. Phase 1 measures it on the reference game. If it
costs more than 0.05 ms of JS, the scan skips subtrees under a frozen static-transform root, whose
movement `static-transform.ts` already checks once per frame.

## Acceptance Criteria

- [ ] AC-1 [local]: In the VSM proof harness, a sphere that moves for 12 frames with no `trackCaster` call, under a still camera, has a shadow that matches the stock shadow arm within the harness's existing changed-pixel bound on every frame. proof: `sh scripts/xvfb.sh pnpm exec tsx packages/core/scripts/vsm-proof/run.mjs` (new `track=auto` arm, adapter named in `out/results.json`, not SwiftShader).
- [ ] AC-2 [local]: In `examples/abyss-framework`, a caster that moves while the camera holds still reports as an automatic mover, and the cached levels do not redraw in full. proof: `node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/shadow-movers.playtest.json --url http://127.0.0.1:5173 --server-command "pnpm --filter abyss-framework dev --host 127.0.0.1" --browser-recipe webgpu`.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
|---|---|---|---|
| Automatic mover classification | Any scene with `light.shadow.shadowNode = new VirtualShadowNode(...)` → `VirtualShadowNode.updateBefore` (`virtual-shadow.ts:2229`) | `trackCaster` stays as the "always a mover" override. `invalidateAll` on track/untrack becomes a region redraw. | AC-1, AC-2 |

## Execution Phases

#### Phase 1: Classification in the node

**Status:** IN PROGRESS
**Files:** `packages/core/src/render/virtual-shadow.ts`; `packages/core/__tests__/virtual-shadow.spec.ts`
**Implementation:** Store the last world matrix or instance-matrix version per caster. Run the transitions above. Report `autoMovers` and `autoTransitions` in the stats and the marker. Change the `@constraint` line so that `trackCaster` reads as an override, not a requirement.

- [x] A moved caster becomes a mover in the same frame, and only its old-bounds region is invalidated. proof: `pnpm exec vitest run packages/core/__tests__/virtual-shadow.spec.ts`. Result: 12 new specs green (99 in the file); the same 12 fail on the pre-change source.
- [x] A mover returns to static after `staticAfterFrames` quiet frames, and only its current-bounds region is invalidated. proof: `pnpm exec vitest run packages/core/__tests__/virtual-shadow.spec.ts`. Result: 12 new specs green (99 in the file); the same 12 fail on the pre-change source.
- [x] `trackCaster` pins a mover, `pinStatic` excludes an object, a deforming mesh stays a mover while visible, and an object with `castShadow = false` is never scanned. proof: `pnpm exec vitest run packages/core/__tests__/virtual-shadow.spec.ts`. Result: 12 new specs green (99 in the file); the same 12 fail on the pre-change source.
- [ ] On `examples/abyss-framework`, the classification scan costs at most 0.05 ms JS per frame. proof: `node packages/playtest/dist/runner/cli.js perf` with the `TN_VIRTUAL_SHADOW` scan timing, `--browser-recipe webgpu`.

#### Phase 2: Proof on a real adapter and in the example

**Status:** NOT STARTED
**Files:** `packages/core/scripts/vsm-proof/proof.ts` (a `track=auto` arm); `examples/abyss-framework/src/scenes/WorldProbe.ts` (one moving caster); `examples/abyss-framework/playtests/shadow-movers.playtest.json` (new); `packages/create-threenative/templates/starter/AGENTS.md` and its mirrors
**Implementation:** Add the harness arm and the example caster. Update the starter guidance so that movers are automatic and `trackCaster` / `pinStatic` are overrides.

- [ ] The `track=auto` harness arm passes AC-1 on a hardware WebGPU adapter. proof: `sh scripts/xvfb.sh pnpm exec tsx packages/core/scripts/vsm-proof/run.mjs`.
- [ ] The `shadow-movers` scenario passes AC-2. proof: the AC-2 command.
- [ ] The starter `AGENTS.md` describes automatic movers, and the mirrors and capability manifest are in sync. proof: `pnpm sync:agents --check && pnpm build && pnpm exec vitest run scripts/__tests__/primary-docs.spec.ts`.
