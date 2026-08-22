---
prd_contract: v1
---

# PRD-162 — Tracer streaks and sprite pixel data come home to core

**Status:** COMPLETE, 2026-08-21. Landed as engine commit `e89dd13a`; the sandbox tarball refresh
and its resolution proof followed the same day. Every gate result below was executed on that tree
and quoted from real output.

**Outcome:** a shipped FPS game's hand-written bullet-tracer pool and soft-sprite generator are now
engine mechanisms — `TracerPool3D` and `softCircleDataTexture` on `@threenative/core`'s public
surface — so no game rewrites pooling, travel/fade lifetime, or the WebGPU canvas trap again.

**Depends on:** nothing. Both mechanisms are instances of the ownership boundary the charter
already states; this PRD records their admission under it.

**Blocks:** nothing. The originating game keeps its local copies until its own lane adopts the
engine versions.

**Complexity: 6 → LOW mode.** Two new modules from scratch (+4), two spec files, one documented
guard exemption in `constraints.spec.ts`, capability-manifest regeneration, and documentation.
No package boundary moves; no existing export changes.

**Blast radius: 7 files.** `packages/core/src/{tracers,textures,index}.ts`,
`packages/core/__tests__/{tracers,textures,constraints}.spec.ts`,
`packages/create-threenative/capabilities.json`.

---

## 1. Context

The proving-ground FPS game (`~/projects/threenative/sandbox/fps-framework`) shipped with two
hand-written render helpers:

- `src/render/tracers.ts` — a pooled travelling bullet-streak system: unit cylinder stretched along
  the shot direction, travelling from muzzle toward the hit point, fading out, pool prewarmed at
  zero opacity for the WebGPU pipeline.
- `src/render/particles.ts` — `softCircleTexture(size, hardness)`: a radial-alpha sprite written as
  `DataTexture` pixels because `CanvasTexture` samples black under `WebGPURenderer` (the trap the
  generated docs warn about; this project hit it).

Both are gameplay-agnostic mechanism: pooling, lifetime, orientation math, and a data-format escape
from a renderer trap. Nothing in either decides how a specific game looks. Under the engine's own
rule that plumbing every game repeats belongs in `packages/core/src/`, they were promoted rather
than left for every future shooter to rewrite.

## 2. The decision: instance, not new category

`GPUParticles3D` already covers GPU-dispatched sprite particles and does not cover a CPU-pooled
travelling mesh streak, so a parallel class is justified rather than an extension. Both additions
were designed inside the mechanism rule the charter states — the framework may own pooling,
lifetime, orientation and dispatch provided every parameter that decides appearance comes from the
game:

- **The suggested default-material shape was vetoed by the rule itself.** The original brief
  proposed "an additive MeshBasicMaterial built from an optional colour param". A default material
  is exactly the "sensible default reached through a config option" the charter forbids, and
  `constraints.spec.ts` mechanically bans constructing surfaces in core outside documented
  exemptions. `material` is therefore required from the game (cloned per slot so streaks fade
  independently), matching `GPUParticles3D`, which takes its surface from the game.
- **Geometry is overridable** with a neutral unit-cylinder substrate default — the same standing as
  `GPUParticles3D` extending `Sprite`. Any geometry laid out along +Y works; cross-section and
  silhouette belong to the game.
- **Fading is parameter-free** (linear across `lifetime`) instead of the game's hardcoded ramp;
  muzzle lead (0.16 m cap) and minimum distance (0.05 m) stay as mechanism constants.

## 3. What shipped

- `TracerPool3D(parent, options)` with `spawn(from, direction, distance)`, `update(dt)`,
  `dispose()`. Options: `count?` (12), `geometry?: BufferGeometry`, `material: Material`
  (required; its `opacity` is the fade peak; transparency forced on), `segmentLength?` (3.2),
  `speed?` (360), `lifetime?` (0.11). Fail-closed validation throughout; members start visible at
  zero opacity so the pool doubles as a pipeline prewarm surface beside the existing `prewarm`.
- `softCircleDataTexture(size = 64, hardness = 0.25): DataTexture`, direct port with fail-closed
  size/hardness validation and the canvas-under-WebGPU trap documented in its JSDoc.
- `constraints.spec.ts` gained a documented exemption for `tracers.ts` on the same terms as
  `renderer.ts` and `particles.ts`: it must name and fade surfaces but constructs none.
- Capability manifest regenerated 113 → 115 entries from the JSDoc tags.

## 4. Evidence

Red-green: both spec files failed first with `Cannot find module '../src/tracers.js'` /
`'../src/textures.js'` (`Test Files 2 failed (2)`); after implementation the full core suite
reported `Test Files 33 passed (33) / Tests 289 passed (289)`. One real defect was caught by the
dts build, not vitest: `geometry` missing from `ITracerPool3DOptions` failed
`pnpm --filter @threenative/core test`; fixed before landing. Gates on the landing commit:
`pnpm typecheck` exit 0; `pnpm lint` exit 0 after Biome formatted the two new files (its 2 errors
were formatter diffs in those files); publint `All good!`.

A three r185 finding worth keeping: `Texture.needsUpdate` is a setter without a getter, so tests
observe the upload flag via the bumped `version` counter (a fresh `DataTexture` sits at 0; setting
it makes 1).

## 5. Adoption path

The sandbox installs packages from tarballs, so the refreshed build was packed per
`scripts/make-sandbox.ts` convention into `.packages/threenative-core-0.2.0.tgz` and reinstalled in
fps-framework; importing `@threenative/core` there resolves `TracerPool3D: function` and
`softCircleDataTexture: function`. The originating game still runs its local copies; switching to
the engine imports is that lane's change to make, not part of this promotion.
