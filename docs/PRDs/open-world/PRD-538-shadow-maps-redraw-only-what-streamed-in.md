# PRD-538 — Shadow maps redraw only what streamed in

**Status:** NOT STARTED
**Priority:** P1 — Open: streaming invalidations re-render a whole shadow map several times a second, which keeps PRD-478's walking GPU p95 above 8.3 ms.
**Complexity:** 6 (MEDIUM) — one engine module family (`render/virtual-shadow*.ts`), a partial render path through three's shadow pass, and a pixel-equivalence proof
**Owner:** João
**Depends on:** none. PRD-478's AC-2 depends on this PRD.

## Context

Measured on Machinefall `map-walk`, desktop RTX 2080, live clock, PRD-478 branch `1fe8b3087` (2026-10-08):

| Fact | Value |
| --- | --- |
| Shadow levels | one, ±250 m, 4096² (`shadowExtents: [250]`) |
| Level renders per walk | 200–280 on `1fe8b3087`, 68–79 after PRD-478's `5a6d9d02f`/`ed75639ef` stopped terrain swaps and non-casting arrivals from invalidating; 13–20 are window moves |
| Invalidation delay | 0.25 s: the default is `0.25 * extent / finestExtent`, and a single level is its own finest |
| GPU p95 per 1500-frame route window | 3–4 ms late in the route; 9–12 ms early, where streaming is heaviest |
| Shadow GPU p95 in those windows | 3.9–6.6 ms |

A streamed cell changes a small part of the map, but `VirtualShadowNode` redraws the whole level for it. `invalidateRegion(region)` already says which part changed; today it only chooses *which levels* redraw.

A longer delay is not the fix. It cuts renders but lets a newly streamed caster's shadow arrive late near the player, which PRD-478's AC-3 forbids.

## Solution

Redraw only the pages an invalidation touched. The level window is already a grid of `pagesPerAxis²` virtual pages (`virtual-shadow-pages.ts`), and window moves already snap to it. An invalidation with a region marks the pages it overlaps dirty. A redraw then renders only the dirty pages' rectangle:
- The shadow camera gets `setViewOffset` for that rectangle, so its depth values are the full map's.
- The target's viewport and scissor are the same rectangle.
- The rectangle's depth is reset first, because a WebGPU clear ignores the scissor.
- Casters are culled to the sub-frustum.

A window move, an invalidation with no region, or more than half the pages dirty still redraws the whole level.

Design notes from reading three r18x (2026-10-08):
- `Renderer` takes the viewport from `renderTarget.viewport`. It applies `renderTarget.scissor` only while the canvas target has `setScissorTest(true)`, so both must be set and restored around the partial render.
- A WebGPU clear wipes the whole attachment whatever the viewport. A partial redraw that clears would erase the rest of the map.
- An admission only adds casters, and an added caster can only bring a texel's depth closer, so an admission-only redraw needs no clear: render the new casters into the dirty rectangle with the existing depth test. An eviction removes casters, which needs the old depth cleared, so evictions keep the full redraw (or a later depth-reset pass). This splits Phase 2 into an admission path that is safe without a clear and an eviction path that stays full.
- `ShadowNode.renderShadow` calls `shadow.updateMatrices(light)`, which builds the receivers' `shadowMatrix` from the camera's current projection. A `setViewOffset` applied before it would make every receiver sample the sub-rectangle as if it were the whole map. Apply the view offset after `updateMatrices`, or rebuild `shadowMatrix` from the full projection after the render.

Layer: mechanism only, `packages/core/src/render/`. Nothing a game sets changes, and no appearance parameter is involved.

## Decisions

- 2026-10-08, decided by the agent while the owner was away: this is a separate PRD rather than a fourth PRD-478 phase, because PRD-478 has three phases (R5).

## Acceptance Criteria

- [ ] AC-1: a partial redraw produces the same depth texels as a full redraw of the same scene. proof: a spec that renders both and compares the depth bytes inside and outside the dirty rectangle.
- [ ] AC-2: Machinefall `map-walk` route-window shadow GPU p95 falls against this PRD's base. proof: 3 interleaved live-clock pairs, `TN_FRAME_BUDGET` `gpuShadowP95`, 1500-frame windows.
- [ ] AC-3: no visual loss. proof: a blind A/B against the base on the 4 `map-walk` and 4 `map-views` poses, plus the `world-capture` pop series.

## Execution Phases

#### Phase 1: Dirty pages
**Status:** NOT STARTED
**Files:** `packages/core/src/render/virtual-shadow.ts`, `virtual-shadow-pages.ts`; `packages/core/__tests__/`

- [ ] `invalidateRegion` marks the pages of each level the region overlaps; a redraw with no region, a window move, or more than half the pages dirty marks the whole level. proof: red-green spec on the dirty-page set.
- [ ] Stats report pages redrawn per render next to `rendersTotal`. proof: spec reading `stats`.

#### Phase 2: Partial redraw
**Status:** NOT STARTED
**Files:** `packages/core/src/render/virtual-shadow.ts`

- [ ] An admission-only redraw renders only the dirty rectangle (`setViewOffset` after `updateMatrices`, matching viewport and scissor, no clear, casters culled to the sub-frustum), and eviction or region-less invalidations keep the full redraw. proof: AC-1's depth-equivalence spec, with an admission case and an eviction case.
- [ ] The native host draws the same rectangle. proof: a native conformance case or a `--target desktop` playtest of a streamed world (repository rule: a web-only path is unfinished).

#### Phase 3: Measure on Machinefall
**Status:** NOT STARTED
**Files:** none in the engine

- [ ] AC-2's timing pairs. proof: `TN_FRAME_BUDGET` windows, recorded here.
- [ ] AC-3's blind A/B and pop series. proof: sheets on the PR.

## Blocked on

- Final timing needs the desktop RTX 2080 at low load. On 2026-10-07/08 it sat at load 6–33 because of other sessions.
