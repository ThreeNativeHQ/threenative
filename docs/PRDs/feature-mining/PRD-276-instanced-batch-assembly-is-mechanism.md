---
prd_contract: v1
---

# PRD-276 — instanced batch assembly is mechanism, and the count cannot be known up front

**Status:** COMPLETE (web) — filed and implemented 2026-08-30 against `9b97d704`. Native lane
`UNVERIFIED`: the export is portable `three` with no browser global and no platform seam, and core
carries no export condition, but no `--target desktop` run was executed for it.

**Goal: a game stops hand-writing the accumulator that `new InstancedMesh` forces on it.** Mined
from `lumen-hall`, a Gothic-cathedral sandbox game and the best-looking thing built on this
framework. Its render folder wrote this helper for itself; the rest of that folder is look and stays
where it is.

**Complexity:** 147 code lines in one new core module, one caller, one spec = **LOW**.

## The problem

`new InstancedMesh(geometry, material, count)` demands `count` before the first instance has been
placed. A procedural builder — which is what an agent writes when it has no artist and is authoring
props in code — therefore does one of three things: walks its own layout twice, over-allocates and
patches `.count` afterwards, or gathers transforms into an array and builds from its length.

Measured in the mined game:

| Site | Shape | Count |
| --- | --- | --- |
| `furnishings.ts:287` | the gather-into-an-array helper, written by hand | 62 code lines |
| `furnishings.ts` | `place` — one instance from position/scale/euler | 52 calls |
| `furnishings.ts` | `rod` — one instance stretched from A to B | 13 calls |
| `furnishings.ts` | `batch` declarations, one per geometry+material pair | 17 |
| `cathedral.ts` | hand-counted instance totals (`bays * 2`, `(bays + 1) * 2`, a literal `27`) | 8 |

The failure mode on the other side of it is already documented inside core:
`packages/core/src/projection-apply.ts:146` records that `new InstancedMesh` built with no instances
"passes every type check and draws nothing. Nothing throws, nothing warns."

Two more repetitions ride along and are cheap to fold in:

- **Bounds.** An `InstancedMesh` whose `boundingSphere` was never recomputed is culled against one
  un-transformed copy, so a spread-out batch pops out of view while half of it is on screen.
- **From-A-to-B.** Chains, tie rods, railing bars, struts and cables are authored as two endpoints,
  not as a position and an Euler angle. Thirteen sites in the mined game derive that quaternion.

## Why this is core and not template source

Charter rule 3 is a veto over rule 1, and it does not fire here. `InstancedBatch` decides nothing
about appearance: `geometry` and `material` are **required** options with no defaults, held by
reference so recolouring the game's own instance recolours every draw; every transform is the
game's; `castShadow` and `receiveShadow` default to Three.js's own `false` rather than to a value
this package picked. The charter's test — *can the game change the appearance completely without
editing package code?* — is yes for every parameter, because there is no appearance parameter the
package holds.

It lands in the row the "where a change goes" table already writes for it: *the mechanism that puts
something on screen — pooling, lifetime, billboarding, instancing, dispatch, culling — when every
appearance parameter comes from the game*. Instancing and culling are both named there.

The charter clause is `docs/architecture/CHARTER.md` → "Instanced batch assembly is mechanism",
filed on the same terms as `TracerPool3D`.

### What was mined and rejected

Judged by the same rules and refused, so the next survey does not re-propose them:

- **`WorldEnvironment`** — the game's SSGI/denoise/godrays/SSR/bloom chain. Picks the tonemap
  operator, the stage order and the composite maths, and carries defaults that pick them for the
  game. Rule 3 veto: it belongs in `templates/*/src/render/`, never on a package surface.
- **The flicker driver** (`animateFires`) — its two-offset-sine curve *is* the look. Stripped of the
  curve it is `setMatrixAt` in a loop, which `InstancedMesh` already provides. The one real slice —
  a game needs to know which index its prop got — is folded in as the return value of `place`,
  `span` and `add`.
- **`surfaces.ts`'s material classification** — every predicate encodes one building's private
  conventions ("the floor is the only material under roughness 0.3", "`toneMapped: false` is only
  ever the glass"). The mechanism does not separate from the choices, and the real fix is a geometry
  builder that returns its materials.
- **`metalEnvironment`'s procedural cube** — the generic slice (build a `CubeTexture` from a
  game-supplied per-direction function) passes the veto, but at one call site the kill switch cannot
  be scored positive.
- **Merge-with-per-part-tint** (`part`/`weld`, 45 + 12 sites) — passes the same rules as this PRD
  and has the largest raw saving in the survey. Deferred only because no example or template in this
  repository authors merged geometry today, and an export with no caller does not ship. Filed
  separately as [PRD-277](../useful-defaults/PRD-277-merged-geometry-keeps-its-per-part-tint.md).

## The kill switch

| | Lines |
| --- | --- |
| `packages/core/src/instanced-batch.ts` | 147 code (216 with docs) |
| Hand-written equivalent in the mined game | 62 code, per game that needs it |
| Racing template caller, code lines before → after | 211 → 210 |

The caller is one line shorter and collapses ten draws into one, so the abstraction is not paying
for itself in ceremony at its own call site. The package cost is real and is justified by the
count-up-front problem: the 62-line helper is what a game writes *instead* of importing this, and
the eight hand-counted totals in `cathedral.ts` are what it writes when it does not.

Re-counted 2026-08-30 against the rewritten `furnishings.ts` (1,187 → 1,301 lines: `candle` split
into `candle` + `lightWick`, an exported `IFlamePlacement` and `AUTHORED_STANDS`, and a billboarded
halo now built from core's own `softCircleDataTexture`). **The call-site counts did not move** —
52 `place`, 13 `span`/`rod`, 17 batch declarations — and the helper measured 62 code lines rather
than 63. The mechanism this PRD extracts survived a rewrite of everything around it, which is the
strongest evidence available that it is mechanism and not that game's look.

Those are the numbers as they stood **before adoption**. The game has since been repointed at this
class (see AC7): `furnishings.ts` no longer contains `batch`, the `Matrix4[]` accumulator, the
shared scratch `Object3D`, or the axis-to-axis quaternion at all. The 62 lines are not saved in
theory, they are deleted.

An honest negative result from the same measurement: batching the racing track's **five** corner
markers cost 15 net lines for 4 fewer draws, and was reverted. A batch earns its two extra lines
when the count is unknown or large; five known props are neither, and the template now says so in a
comment.

## Acceptance criteria

- [x] **AC1 — the batch builds what it was given.** `packages/core/__tests__/instanced-batch.spec.ts`
      reads every instance matrix back off the built mesh.
- [x] **AC2 — the index is addressable.** `place` returns the instance index; writing that index
      moves one instance and leaves its neighbours alone.
- [x] **AC3 — red-green, culling.** Removing `mesh.computeBoundingSphere()` from `build` fails
      *"bounds the batch around every instance so the culler does not drop a spread-out one"* with
      `AssertionError: expected 0 to be greater than 50`.
- [x] **AC4 — red-green, the empty batch.** Removing `if (this.#matrices.length === 0) return
      undefined;` fails *"returns undefined rather than a mesh that draws nothing"* with
      `expected { Object (isObject3D, uuid, ...) } to be undefined` — the count-zero mesh that draws
      nothing and warns nothing.
- [x] **AC5 — red-green, the fixed count.** Removing the three `#assertOpen` calls fails *"refuses
      to place after build"* with `AssertionError: expected [Function] to throw an error`.
- [x] **AC6 — it originates no appearance.** `packages/core/__tests__/constraints.spec.ts` exempts
      the module on the same terms as `tracers.ts` and asserts it constructs no material, light or
      colour, reads no property that describes how anything looks, and contains no hex literal.
- [x] **AC7 — named callers, two of them.**
      1. **The mined game itself**, which is the strongest caller available: `lumen-hall` was
         repointed at freshly packed tarballs (the installed `dist/index.js` verified to carry the
         class, 17 occurrences) and its hand-written accumulator deleted, with `place` and `rod`
         surviving as two-line adapters over `place` and `span` so **all 65 call sites were
         untouched**. Measured across the swap: **draw calls 154 → 154, identical**; triangles
         1,686,883 → 1,679,511; fps 90.1 → 92.6; all three of that game's scenarios still pass.
         Sandbox commit `dd40d67`. Draw-call parity is the result to want here — the game already
         batched by hand, so the class earned its place by being a clean substitution, not by
         changing the frame. `span` took the thirteen `rod` sites without reshaping any of them.
      2. **`templates/racing/src/track/Track.ts`**, which gathers the ten kerb stones into one
         batch. The scaffolded racing project's own `pnpm test` passes against a freshly packed
         local framework: `racing: scaffolded playtests passed.`
- [x] **AC8 — the capability is discoverable.** `capabilities.json` 171 → 172 entries;
      `tsx scripts/check-capability-docs.ts` reports 78 exports with complete tags, and
      `detect-capability-duplicates.ts` finds no collision.
- [ ] **AC9 — native.** `UNVERIFIED`. No `--target desktop` run was executed.

## Gates run 2026-08-30

- `pnpm typecheck` — green for every project except `packages/assets`, which carries another
  session's in-flight edit (`compile.ts:972`, modified during this run). Re-run with
  `--filter '!@threenative/assets'`: 17 of 19 projects, all Done.
- `pnpm lint` — every file this change touched is clean (`biome check` over them: no fixes applied).
  The gate's remaining 5 errors are all in that same lane's untracked
  `packages/assets/__tests__/model-texture-pass.spec.ts`.
- `npx vitest run packages/core/__tests__` — **71 files, 706 tests passed.**
- `npx vitest run scripts packages/create-threenative/__tests__` — 96 files, 1012 tests passed;
  2 failed, both traced to the assets lane (`scripts/.tmp-measure/measure.ts`, an unregistered
  temporary directory dropped at 09:06 that imports `packages/assets/src/passes/model.js`, and a new
  `as unknown as` suppression at `packages/assets/src/compile.ts:981`).
- `pnpm budgets` — passed; the two LOC lines are review triggers, not failures.
