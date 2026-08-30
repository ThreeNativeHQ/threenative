---
prd_contract: v1
---

# PRD-266 — `WorldEnvironment` is a seam the game fills, and it names the tier it actually ran

**Status:** PROPOSED — filed 2026-08-29, measured at `7e5a9fe1`. Batch:
[docs/PRDs/lighting](./README.md), which carries the repo evaluation this PRD implements.

**Updated 2026-08-30 from a working prototype.** The whole chain was built by hand inside a
sandbox game (`../sandbox/lumen-hall`, installed from tarballs) to find out what the
framework version has to handle. Evidence:
[docs/verification/lighting-chain-2026-08-30.md](../../verification/lighting-chain-2026-08-30.md).
Two changes fall out of that and are folded in below: the abstraction is named
`WorldEnvironment`, and four defect classes have been observed rather than predicted.

**Goal: a game asks for global illumination once, gets the best chain the running target can
execute, and can always read which one it got.** Today it cannot do either half.

**Complexity:** one new core module, one renderer capability probe, one report surface, plus
template call-site changes = **MEDIUM**. No new dependency: every node named here already ships
inside `three@0.185.1`.

## The problem, measured at `7e5a9fe1`

### 1. There is no chain — there is one hard-coded line per template, and it throws off WebGPU

All seven templates carry the same `src/render/postprocessing.ts` shape
(`packages/create-threenative/templates/starter/src/render/postprocessing.ts`):

```ts
if (renderer.kind !== "webgpu") return;
const colour = pass(scene, camera).getTextureNode();
renderer.setOutputNode(colour.add(bloom(colour, 0.7, 0.5, 0.2)));
```

Bloom, and nothing else. The `kind !== "webgpu"` early-return is the entire portability story, and
it is **silent** — a WebGL fallback session renders with no post at all and reports nothing about
it. `packages/core/src/renderer.ts:310` throws `setOutputNode is unavailable on the ${kind}
renderer.`, so the template is right to guard; it is wrong to guard without telling anyone.

Adding `ssgi()`, `ssr()`, `gtao()` and a denoiser to that expression is not a template change —
it is seven copies of an ordering problem. AO must feed GI, GI must feed the denoiser, the
denoiser must precede the temporal resolve, and the temporal resolve must precede tonemapping.
Get it wrong and the result is dim, or noisy, or ghosting, and nothing in the frame says which.

### 2. Nothing can degrade lighting on evidence, though the machinery for exactly that already exists

`packages/core/src/resolution-scaler.ts` is the precedent: rungs pre-registered in a constant
block, driven by `display.maxFps`, wired into `Game` at `packages/core/src/game.ts:800`, and every
fps number it reports carries a `ScaleSource` (`"pinned" | "auto" | "auto-pinned"`) naming how the
scale was arrived at. `FrameBudget` (`packages/core/src/frame-budget.ts:280`) already publishes
per-phase costs under `FRAME_BUDGET_MARKER`, including a `render` phase.

SSGI at `sliceCount: 3, stepCount: 16` and SSGI at `sliceCount: 1, stepCount: 12` differ by roughly
4× in samples per pixel — SSGINode's own docblock states the presets. That is a bigger lever than
one resolution rung, and no game can pull it without hand-writing the ladder that
`ResolutionScaler` already proved is framework work rather than game work.

### 3. Four defaults each read as "the stage is on and does nothing"

Observed, not predicted. Every one of these was hit while building the prototype, and every
one produced a frame that looked plausible rather than an error:

- **`SSRNode.maxDistance` defaults to `1`** — one world unit. On a 63 m interior every
  reflection ray terminated within a metre of its origin and the floor reflected nothing.
- **`SSRNode` `reflectNonMetals` defaults to `false`.** Polished stone is not a metal, so
  even with the ray distance corrected nothing reflected.
- **`colorNode` and `normalNode` must be texture nodes**, because both are `.sample()`d
  inside the pass. `@types/three` types `normalNode` as `Node<"vec3">`, which invites a
  `.xyz` swizzle that typechecks and then dies at shader build. `ssgi()` runs its colour
  input through `convertToTexture` in its factory; `ssr()` does not.
- **`toneMappingExposure` does not reach a frame drawn through a `RenderPipeline` output
  node.** Moving it from 0.85 to 1.45 changed nothing on screen.

A game cannot be expected to know any of these, and each one costs an afternoon to find. The
`WorldEnvironment` defaults exist to make the correct thing the default: scene-scaled ray
distance, non-metal reflection on, exposure applied inside the chain.

### 4. A dropped effect is indistinguishable from a disabled one

The charter is explicit: turning a convention off must not turn its measurement off. Right now a
game whose SSGI never ran — no WebGPU, no `timestamp-query`, a target the node cannot compile on —
looks exactly like a game that chose not to use SSGI. No marker, no report field, no playtest
assertion can tell them apart, which means no gate can either.

## What ships

A new `packages/core/src/render/world-environment.ts`, exported from `@threenative/core`:

- `WorldEnvironment` — composes an ordered node graph from a **request** (which stages, at
  which quality) and the running target's **capabilities**, installs it through the existing
  `IRendererLike.setOutputNode` seam, and disposes cleanly on tier change.

  **The name is Godot's, and `RenderChain` — this PRD's original invention — is withdrawn.**
  Charter rule 4 borrows vocabulary and never invents it. Godot's `WorldEnvironment` node is
  exactly this object: the thing that says which lighting effects a scene runs and how strong
  they are. Its property names carry across too, so a game writes `ssrEnabled` and
  `tonemapMode` where Godot writes `ssr_enabled` and `tonemap_mode`, and Three.js's node
  names win for the stages Godot has no equivalent for (`ssgi`, `gtao`). `Environment` alone
  was rejected: `scene.environment` in Three.js is a texture, and the collision would cost
  more than the extra word.
- A capability probe: renderer `kind`, adapter info, and per-stage compile success. Fail closed —
  a stage that cannot compile is dropped and *named*, never silently skipped.
- Tier ladder in one pre-registered constant block, in the `RESOLUTION_SCALER` shape: named tiers
  (`high`/`medium`/`low`/`off`) mapping to the SSGI/SSR/denoise parameters that upstream's own
  docblocks recommend, selected from the `FrameBudget` `render` phase against `display.maxFps`.
- `environment.applied` — the tier that actually ran, the stages that ran, and for each stage that did
  not, the reason. Emitted under a `TN_WORLD_ENVIRONMENT` marker on the same path `TN_FRAME_BUDGET`
  uses, so the playtest bridge and `doctor --url` can both read it.

**`WorldEnvironment` owns ordering, availability and degradation. It owns no appearance.** Every colour,
strength, exposure and tonemap stays in `templates/*/src/render/`, which is what PRD-267 fills in.
A stage the game did not request is never added.

## Acceptance criteria

1. **A requested stage that cannot run is reported, not skipped.** A `WorldEnvironment` requesting SSGI against
   a non-WebGPU renderer produces `environment.applied` with SSGI absent and a reason naming
   the renderer kind, and emits `TN_WORLD_ENVIRONMENT`. *Mutation:* restore the bare
   `if (kind !== "webgpu") return;` early-return and the new negative-control spec goes green with
   an empty report it could not have earned.

2. **Order is fixed by `WorldEnvironment`, not by the caller.** Requesting the stages in scrambled order
   produces the same installed graph as requesting them in canonical order, asserted on the node
   graph, not on a screenshot. *Mutation:* replace the canonical sort with the caller's array order
   and the scrambled-input spec diverges from the canonical-input spec.

3. **The tier moves on measured frame cost and says so.** With a synthetic `FrameBudget` window
   whose `render` phase exceeds the `display.maxFps` budget for the configured dwell, the environment
   steps down one tier and `environment.applied.source` reports `"auto"`; pinned configuration reports
   `"pinned"` and never moves. *Mutation:* freeze the tier selector at the requested tier and the
   step-down spec fails on both the tier and the source field.

4. **An empty request is a valid no-op, a malformed one throws.** `{}` installs nothing and
   reports nothing applied; an unknown stage name or an out-of-range quality throws at
   construction. *Mutation:* accept the unknown stage name and the fail-closed spec goes green.

5. **A composed chain never contains a dangling branch.** Materialising a node for one stage
   and then composing the *unmaterialised* original into the output builds two copies of the
   same graph, and the un-rendered copy silently produces the background colour. In the
   prototype this appeared only with bloom off, godrays on and SSR on, and it rendered a
   blank frame. *Mutation:* compose a stage's input from the unconverted node while passing a
   converted one to the pass, and the blank-frame spec goes red.

6. **A playtest can assert the tier.** A scenario asserting `worldEnvironment.tier` against a template
   build fails when the chain reports a lower tier than asserted, and fails — not passes — when the
   marker is absent entirely. *Mutation:* drop the marker emission and the scenario reports
   unobservable rather than green (the PRD-265 rule).

## Out of scope

Probe volumes (PRD-268), motion vectors (PRD-269), native conformance cases for the new nodes
(PRD-270), and any decision about which effects a template turns on (PRD-267).

## Known gap the tier ladder has to work around

`SSGINode` has no `resolutionScale`, and resets itself to the full display resolution every
frame inside `updateBefore`. `SSRNode` has one, and halving it on the prototype recovered
34.5 to 46 fps. SSGI is the most expensive stage in the chain by a wide margin — 42.9 fps
with it against 107 without — so the one lever that would help most is the one upstream does
not expose. The tier ladder therefore has only `sliceCount` and `stepCount` to work with on
that stage, which is a much coarser control than the resolution knob every other stage has.
Worth an upstream contribution rather than a fork.

## Verification

`pnpm typecheck && pnpm lint && pnpm test`, plus a playtest scenario driving the starter template
that asserts a non-`off` tier on the browser lane and pastes `TN_WORLD_ENVIRONMENT`. Record in
`docs/verification/` as one file for the run. `pnpm build` must regenerate
`packages/create-threenative/capabilities.json` with the new `WorldEnvironment` entry in the same
commit — a capability absent from the manifest does not exist to the agents that build with it.
