# PRD-027 — `GPUParticles3D` and the output node: the framework owns the dispatch, never the look

**Complexity: 7 → LARGE mode** (6-10 files +2, new public node +2, new renderer surface +1,
templates and arm ported +2)

**Depends on:** PRD-025 (the ratchet and the normalised count), PRD-026
(`renderer.compute`, which this node dispatches through).
**Blocks:** the visual baseline in PRD-030 leans on this node for particle-based polish.
**Charter authority:** `AGENTS.md` rule 1 (§2 argues it), rule 3 (**the hard constraint
here**), rule 4 (Godot: `GPUParticles3D`, `start`, `process`, `amount`, `emitting`);
`CHARTER.md` §3, §10.

## 1. Context

**Problem:** the single largest block of the counted framework arm is a GPU particle
system — **86 lines**, of which roughly half is buffer allocation, dispatch plumbing and
sprite wiring that is identical in every GPU-particle game ever written, and half is the TSL
that makes *these* particles look like plankton. The framework absorbs none of it. The
second-largest avoidable block is post-processing: the starter template ships a **19-line
monkey-patch of `renderer.render`** to get a `RenderPipeline` to run, and every generated
project inherits that patch.

Neither is a look. A buffer is not a look; a dispatch is not a look; overriding
`renderer.render` is not a look. The colours, the falloff, the curl of the ambient current —
those are the look, and they stay in the user's `src/render/`.

**Files analyzed:** `examples/abyss-framework/src/scenes/Abyss.ts:83-168`,
`examples/abyss-vanilla/src/main.js:78-166`,
`examples/abyss-framework/src/render/postprocessing.ts`,
`packages/create-threenative/templates/starter/src/render/postprocessing.ts`,
`packages/create-threenative/templates/minimal/src/render/postprocessing.ts`,
`packages/core/src/renderer.ts:34-43`.

**Current behavior:**

| Fact | Evidence |
|---|---|
| The arm's particle block is 86 lines | `Abyss.ts:83-168` |
| Of those, ~40 are allocation, dispatch and sprite wiring, not shader | `Abyss.ts:85-90,102-113,150-168` |
| The same 40 lines exist, near-identically, in the vanilla control | `main.js:80-107,148-166` — the framework saves the user nothing here |
| The template's post file patches `renderer.render` at runtime | `templates/starter/src/render/postprocessing.ts` — save/restore dance around `pipeline.render()` |
| The minimal template's post is tonemapping only — no bloom, no pipeline | `templates/minimal/src/render/postprocessing.ts`, 8 lines |
| The arm's post file re-solves the same wiring a third way | `examples/abyss-framework/src/render/postprocessing.ts`, 20 lines |
| Nothing in `packages/` names particles | `grep -rn "instancedArray\|Particles" packages/*/src` — no hits |

Row three is the finding. A block the framework does not touch is a block where the
framework's LOC claim is exactly zero, and it is the biggest single block in the file.

## 2. Solution

**Why this passes the 20-line rule.** Rule 1 rejects what a competent developer writes in
under 20 lines. Allocating two `instancedArray` buffers, compiling a `start` pass, dispatching
it once at the right moment in the renderer's lifecycle, dispatching `process` every frame
after the fixed-step update but before the render, wiring a `SpriteNodeMaterial` to the
position buffer, setting `count` and `frustumCulled`, and disposing all of it on scene exit
is 40+ lines and three ordering bugs. It is measured at 40 in two independent builds. It
qualifies.

- **`GPUParticles3D`, in `packages/core`, borrowing Godot's names.** `amount`, `emitting`,
  `restart()`, and a `start`/`process` pair — Godot's custom particle shader entry points,
  same meaning: `start` initialises one particle, `process` advances it. Both are **TSL
  functions the user writes**, handed the node's buffers. Construction:

  ```ts
  const plankton = new GPUParticles3D({ amount: 90_000, start, process, material });
  ctx.add(plankton);            // an Object3D, like any other
  ```

- **The node ships no look and no defaults that are a look.** No default colour, no default
  size, no default blending, no default material. `material` is required. A node that looked
  like something out of the box would be `packages/` owning the look, and rule 3 deletes it.
  Its `__tests__` assert the absence: constructing without a material throws.
- **Lifecycle is the framework's job.** `start` dispatches once when the node enters the
  scene graph and again on `restart()`; `process` dispatches once per rendered frame while
  `emitting`; buffers are released on removal. The arm currently does this by hand and gets
  the ordering right by accident of where the calls sit in `enter`.
- **`RendererLike.setOutputNode(node)` replaces the `renderer.render` monkey-patch.** The
  core owns the `PostProcessing`/`RenderPipeline` wiring and the save/restore; the user
  writes the output node — which *is* the look, and stays in `src/render/postprocessing.ts`.
  Every template's post file drops to a handful of lines and gains bloom, which is PRD-030's
  starting point.
- **Ported in the same commit:** the arm, all three templates, and the README block.

### Explicitly rejected

| Proposed | Why not |
|---|---|
| A `ParticleProcessMaterial` equivalent with gravity/spread/lifetime knobs | That is a preset system, closed against in `CHARTER.md` §2, and every knob is a look decision |
| Default colour/size/blending so it "works out of the box" | Rule 3. The out-of-the-box look ships in the template's `src/render/`, where the user can read and change it |
| A separate `@threenative/particles` package | Rule 5: it carries no dependency the others must not inherit. `three/tsl` is already a peer of core |
| CPU particle fallback for WebGL2 | Two implementations of one node, one of which nobody benchmarks. `renderer.compute` throws on WebGL2 (PRD-026) and the node surfaces that throw |
| Keep the `renderer.render` monkey-patch and just copy it into fewer files | It is a patch on a `three` object the user also holds. Framework-owned lifecycle is the whole point |
| Emitters, trails, sub-emitters, collision | Godot has them; we have no measured caller. Rule 1, and the round after this one can find one |

## 3. Integration Ledger

| # | New thing | Live caller (non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `GPUParticles3D` in `@threenative/core` | `examples/abyss-framework/src/scenes/Abyss.ts`; starter template | `Abyss.ts:85-90,102-113,150-168` hand-wiring | yes — deleted, not left beside it | construct with no `material` → throws; construct with `amount: 0` → throws |
| 2 | `start`/`process` TSL entry points | the arm's plankton; the starter's particle module | `computeInit` / `computeUpdate` built and dispatched by hand | yes | a `process` that is not a TSL function → throws at construction, not at frame 1 |
| 3 | Node lifecycle (dispatch on add, release on remove) | `Scene.exit` in the arm | manual `raw.compute(computeInit)` at the right line | yes | remove the node mid-run, assert buffers released and no further dispatch |
| 4 | `RendererLike.setOutputNode` | all three templates' `src/render/postprocessing.ts`; the arm's | the `renderer.render` save/restore patch in each | yes — patch deleted from every copy | set an output node on WebGL2 → throws naming the kind; assert the renderer's `render` is still the original function afterwards |
| 5 | Regenerated README LOC block + lowered `loc-baseline.json` | CI | the pre-change baseline | n/a | forget the baseline → PRD-025's ratchet fails the build |

**Reachability:** a user scaffolds, opens `src/render/particles.ts`, edits a colour ramp,
and never writes an `instancedArray`, a `.compute()` call, or a `renderer.render` patch.

## 4. Phases

#### Phase 1: the node

**Files:** `packages/core/src/particles.ts` NEW · `packages/core/src/index.ts` EDIT ·
`packages/core/__tests__/particles.spec.ts` NEW.

Construction, validation, buffer allocation, `emitting`, `restart()`, release. Tests use a
fake renderer recording dispatches — no GPU. Assert: `start` once on add, `process` once per
frame, nothing while `emitting` is false, both buffers released on remove, and every
validation throw listed in the ledger.

#### Phase 2: the output node

**Files:** `packages/core/src/renderer.ts` EDIT · `packages/core/__tests__/renderer.spec.ts` EDIT.

`setOutputNode`, owning the pipeline and the restore. Test that the renderer's own `render`
reference is unchanged after set and after dispose — the failure the current patch can leave
behind.

#### Phase 3: port every caller

**Files:** `examples/abyss-framework/src/scenes/Abyss.ts` EDIT ·
`examples/abyss-framework/src/render/postprocessing.ts` EDIT ·
`packages/create-threenative/templates/{minimal,starter,platformer}/src/render/postprocessing.ts` EDIT ·
`packages/create-threenative/templates/starter/src/render/particles.ts` NEW.

The starter gains a particle module — generated source, the user's to edit — so the node has
a template caller as well as a benchmark one. The arm's plankton keeps its exact TSL bodies:
this phase must be visually identical, and PRD-030's screenshot gate is what proves it.

#### Phase 4: gates

`pnpm typecheck && pnpm lint && pnpm test && pnpm budgets`, plus the arm's playtest scenarios
green against the real build, plus `count-loc` showing the normalised framework total **down
by ≥45 lines** with `loc-baseline.json` lowered to match, plus a before/after screenshot pair
of the arm at the same scene time showing no visual change. Report the actual line delta,
including if it is smaller than 45.
