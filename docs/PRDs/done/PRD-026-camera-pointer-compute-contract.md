# PRD-026 — The camera, the pointer and the compute call: three contracts the game fights

**Complexity: 5 → MEDIUM mode** (3-6 files +1, existing systems +0, new public surface on
three core types +2, template and arm updates +2)

**Depends on:** PRD-025 (its savings are only readable against a normalised count).
**Blocks:** nothing.
**Charter authority:** `AGENTS.md` rule 1 (the 20-line rule — read §2 for why this passes
it), rule 4 (Godot vocabulary), rule 3 (this PRD must not touch the look);
`CHARTER.md` §3.

## 1. Context

**Problem:** `defineGame` hard-codes one `PerspectiveCamera`, `Viewport.resize` only knows
how to resize that one class, `RendererLike` has no `compute`, and nothing converts a
pointer position into world units. A game whose framing is not "60° perspective" therefore
writes a workaround, and the Abyss arm writes **~30 lines of it** — every one of them a line
the vanilla arm never pays, because plain Three.js lets you construct the camera you want.

This is not a missing convenience. It is the framework charging rent for a decision it made
on the user's behalf.

**Files analyzed:** `packages/core/src/game.ts:1,169-183`, `packages/core/src/viewport.ts:60-66`,
`packages/core/src/renderer.ts:5-12,34-43`, `packages/core/src/scene.ts:31-53`,
`examples/abyss-framework/src/scenes/Abyss.ts:40-81,226-263,380`,
`examples/abyss-vanilla/src/main.js:58-76,233-238`.

**Current behavior:**

| Fact | Evidence |
|---|---|
| The camera is constructed by the core, unconfigurable | `game.ts:169` — `new PerspectiveCamera(60, 1, 0.1, 2_000)`; `GameConfig` has no camera field |
| An orthographic game fakes it with a distant narrow-fov perspective camera | `Abyss.ts:56-68` — 13 lines, 7 of them comment explaining the trick |
| `Viewport.resize` updates aspect only for `PerspectiveCamera` | `viewport.ts:62-65` — an `OrthographicCamera` silently never reframes |
| Screen → world is hand-rolled per game | `Abyss.ts:252-259`; the vanilla arm does the same in 5 lines at `main.js:233-238` |
| `RendererLike` cannot dispatch a compute node | `renderer.ts:5-12`; the arm declares `type RawComputeRenderer` and casts `ctx.renderer.raw` | 
| The cast is then guarded twice per frame path | `Abyss.ts:41,73,233,380` — `typeof raw.compute === "function"` |
| Every one of these lines is classified **plumbing-shaped but counted as game** | `count-loc.ts:83-89` — only imports, types and `#field` lines are plumbing in the framework arm |

**Measured cost in the counted arm:** 13 (camera framing) + 8 (`pointToWorld`) + 4 (compute
cast and its two guards) + ~5 (the `field`/`layout`/`onResize` block that exists only because
the camera does not know its own world extent) ≈ **30 lines**, against a normalised gap of 7
(PRD-025). This PRD is the one that turns a tie into a win.

## 2. Solution

**Why this passes the 20-line rule.** Rule 1 rejects abstractions a user could write in
under 20 lines *for themselves*. A user cannot write these: the camera is constructed inside
`defineGame` before any user code runs, `Viewport` is the only thing subscribed to the
resize, and `renderer.raw` is typed `unknown` by the framework's own contract. These are
completions of contracts the framework already owns, and each one **deletes** more user code
than it adds. If any of the three ends up net-positive in the LOC table, rule 2 applies to
it in the same round.

- **`camera` becomes configurable, in Godot's vocabulary.** `GameConfig.camera` takes
  `{ projection: "perspective", fov?, near?, far? }` or
  `{ projection: "orthogonal", size, near?, far? }` — Godot's `Camera3D.projection` and
  `Camera3D.size`, camelCased, with `size` meaning the same thing it means there (the
  vertical extent in world units). Default stays exactly what `game.ts:169` builds today, so
  no existing project moves.
- **`Viewport.resize` reframes whichever camera it was given.** Perspective updates `aspect`;
  orthogonal updates `left/right/top/bottom` from `size` and the live aspect. The
  `PerspectiveCamera` special-case at `viewport.ts:62` becomes a two-branch switch.
- **`ctx.camera.projectPosition(screen, z)` and `unprojectPosition(world)`** — Godot's
  `Camera3D.project_position` / `unproject_position`, same semantics, camelCase. Exposed on
  the viewport (`ctx.viewport.projectPosition`) rather than by subclassing `three`'s camera:
  vocabulary is borrowed, but a patched `three` class is not something the user can hand back
  to plain Three.js code, and rule 4 does not license monkey-patching.
- **`RendererLike.compute(node)`** dispatches on WebGPU and **throws** on WebGL2 with a
  message naming the renderer kind. It does not silently no-op: a compute game that renders
  a still frame because the dispatch quietly vanished is the failure mode `AGENTS.md`
  "fail closed" exists to prevent. `ctx.renderer.kind` is already the documented way to ask
  first.
- **The Abyss arm and every template are ported in the same commit**, and the README LOC
  block is regenerated as part of the change. A contract with no caller is not shipped.

### Explicitly rejected

| Proposed | Why not |
|---|---|
| A `Camera2D` / `Camera3D` node wrapper class | Invents a second camera type the user must convert back to `three` at every boundary. Rule 4 borrows Godot's *names*, not its object graph |
| `ctx.camera.projectPosition` by subclassing `PerspectiveCamera` | A camera that is not a plain `three` camera breaks "vanilla `three` on every surface underneath" |
| `compute()` as a no-op on WebGL2 | Fails open. A blank-looking game with green tests is the exact v1 failure `AGENTS.md` names |
| Auto-detect the projection from the scene | Magic that is wrong once and then unexplainable. The game declares its framing |
| A `follow`/`shake`/`lookAt` camera helper in core | Rule 1: those are under 20 lines in user space, and rule 3 makes framing part of the look. They belong in `src/render/camera.ts`, where the starter template already has one |
| Ship the contract now, port the arm later | Then the LOC table never moves and rule 2 has nothing to score |

## 3. Integration Ledger

| # | New thing | Live caller (non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `GameConfig.camera` | `examples/abyss-framework/src/main.tsx`; starter template | `Abyss.ts:56-68` fov trick | yes — those 13 lines deleted | `size: 0` or a negative `far` → throws at `defineGame`, not at first frame |
| 2 | Orthogonal branch in `Viewport.resize` | every orthogonal game; `Viewport` tests | a camera that never reframes | yes | resize an orthogonal viewport in the unit test → `left/right` move; delete the branch → test red |
| 3 | `Viewport.projectPosition` / `unprojectPosition` | `Abyss.ts` steering; starter template pointer pick | `Abyss.ts:252-259`, and the same 5 lines in every future game | yes | project a centre-screen point in an orthogonal viewport → `(0,0)`; in a perspective one → within 1e-6 of the manual trig |
| 4 | `RendererLike.compute` | `Abyss.ts` init + per-frame dispatch | `type RawComputeRenderer` and two `typeof` guards | yes — the cast is deleted | call it on a WebGL2 renderer → throws naming `webgl2`; assert the throw in the unit test |
| 5 | Regenerated README LOC block | CI `count-loc --check` | a table that predates the change | n/a | forget to regenerate → CI red |

**Reachability:** a user runs `npx create-threenative`, picks an orthogonal or top-down
game, declares `camera: { projection: "orthogonal", size: 520 }`, reads the pointer with
`ctx.viewport.projectPosition(ctx.input.raw.pointer.position)`, and dispatches a TSL compute
node with `ctx.renderer.compute(node)` — none of it needing `renderer.raw` or a cast.

## 4. Phases

#### Phase 1: the camera is declared

**Files:** `packages/core/src/game.ts` EDIT · `packages/core/src/viewport.ts` EDIT ·
`packages/core/__tests__/viewport.spec.ts` EDIT · `packages/core/__tests__/game.spec.ts` EDIT.

`GameConfig.camera`, the orthogonal branch in `resize`, validation that throws on
non-finite or non-positive `size`/`near`/`far`. Default path unchanged — an existing config
with no `camera` key must produce a byte-identical camera to `game.ts:169`, and a test pins
that.

#### Phase 2: screen ↔ world

**Files:** `packages/core/src/viewport.ts` EDIT · `packages/core/src/index.ts` EDIT ·
`packages/core/__tests__/viewport.spec.ts` EDIT.

`projectPosition(screen, z = 0)` and `unprojectPosition(world)`. Test both projections
against hand-computed values, including a non-square aspect — the failure this catches is
the one `Abyss.ts:244-246` documents, where a never-moved pointer maps to a corner.

#### Phase 3: compute reaches the renderer

**Files:** `packages/core/src/renderer.ts` EDIT · `packages/core/__tests__/renderer.spec.ts` EDIT.

`compute(node)` on `RendererLike`, wired in `wrapRenderer`. Throws on WebGL2 and on a WebGPU
instance that does not expose `compute`. No fallback.

#### Phase 4: port the caller, move the number

**Files:** `examples/abyss-framework/src/scenes/Abyss.ts` EDIT ·
`examples/abyss-framework/src/main.tsx` EDIT ·
`packages/create-threenative/templates/starter/src/**` EDIT (only where it removes lines) ·
`README.md` REGENERATED.

Delete the fov trick, `pointToWorld`, `RawComputeRenderer` and both guards. The scene must
still pass its playtest scenarios — this is behaviour-preserving by construction, and the
proof is that the existing scenarios stay green without edits.

#### Phase 5: gates

`pnpm typecheck && pnpm lint && pnpm test && pnpm budgets`, plus
`pnpm tsx scripts/count-loc.ts` showing the normalised framework total **down by ≥25 lines**
against the PRD-025 baseline, plus the arm's playtest scenarios re-run against the real
build. State the before and after numbers in the verification record; a phase that moved the
count by less than 25 reports that number rather than rounding it up.
