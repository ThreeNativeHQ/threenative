---
prd_contract: v1
---

# PRD-266 — the render chain is a seam the game fills, and it names the tier it actually ran

**Status:** PROPOSED — filed 2026-08-29, measured at `7e5a9fe1`. Batch:
[docs/PRDs/lighting](./README.md), which carries the repo evaluation this PRD implements.

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

### 3. A dropped effect is indistinguishable from a disabled one

The charter is explicit: turning a convention off must not turn its measurement off. Right now a
game whose SSGI never ran — no WebGPU, no `timestamp-query`, a target the node cannot compile on —
looks exactly like a game that chose not to use SSGI. No marker, no report field, no playtest
assertion can tell them apart, which means no gate can either.

## What ships

A new `packages/core/src/render/chain.ts`, exported from `@threenative/core`:

- `RenderChain` — composes an ordered node graph from a **request** (which stages, at which
  quality) and the running target's **capabilities**, installs it through the existing
  `IRendererLike.setOutputNode` seam, and disposes cleanly on tier change.
- A capability probe: renderer `kind`, adapter info, and per-stage compile success. Fail closed —
  a stage that cannot compile is dropped and *named*, never silently skipped.
- Tier ladder in one pre-registered constant block, in the `RESOLUTION_SCALER` shape: named tiers
  (`high`/`medium`/`low`/`off`) mapping to the SSGI/SSR/denoise parameters that upstream's own
  docblocks recommend, selected from the `FrameBudget` `render` phase against `display.maxFps`.
- `chain.applied` — the tier that actually ran, the stages that ran, and for each stage that did
  not, the reason. Emitted under a `TN_RENDER_CHAIN` marker on the same path `TN_FRAME_BUDGET`
  uses, so the playtest bridge and `doctor --url` can both read it.

**The chain owns ordering, availability and degradation. It owns no appearance.** Every colour,
strength, exposure and tonemap stays in `templates/*/src/render/`, which is what PRD-267 fills in.
A stage the game did not request is never added.

## Acceptance criteria

1. **A requested stage that cannot run is reported, not skipped.** A chain requesting SSGI against
   a non-WebGPU renderer produces `chain.applied` with SSGI absent and a reason naming the
   renderer kind, and emits `TN_RENDER_CHAIN`. *Mutation:* restore the bare
   `if (kind !== "webgpu") return;` early-return and the new negative-control spec goes green with
   an empty report it could not have earned.

2. **Order is fixed by the chain, not by the caller.** Requesting the stages in scrambled order
   produces the same installed graph as requesting them in canonical order, asserted on the node
   graph, not on a screenshot. *Mutation:* replace the canonical sort with the caller's array order
   and the scrambled-input spec diverges from the canonical-input spec.

3. **The tier moves on measured frame cost and says so.** With a synthetic `FrameBudget` window
   whose `render` phase exceeds the `display.maxFps` budget for the configured dwell, the chain
   steps down one tier and `chain.applied.source` reports `"auto"`; pinned configuration reports
   `"pinned"` and never moves. *Mutation:* freeze the tier selector at the requested tier and the
   step-down spec fails on both the tier and the source field.

4. **An empty request is a valid no-op, a malformed one throws.** `{}` installs nothing and
   reports nothing applied; an unknown stage name or an out-of-range quality throws at
   construction. *Mutation:* accept the unknown stage name and the fail-closed spec goes green.

5. **A playtest can assert the tier.** A scenario asserting `renderChain.tier` against a template
   build fails when the chain reports a lower tier than asserted, and fails — not passes — when the
   marker is absent entirely. *Mutation:* drop the marker emission and the scenario reports
   unobservable rather than green (the PRD-265 rule).

## Out of scope

Probe volumes (PRD-268), motion vectors (PRD-269), native conformance cases for the new nodes
(PRD-270), and any decision about which effects a template turns on (PRD-267).

## Verification

`pnpm typecheck && pnpm lint && pnpm test`, plus a playtest scenario driving the starter template
that asserts a non-`off` tier on the browser lane and pastes `TN_RENDER_CHAIN`. Record in
`docs/verification/` as one file for the run. `pnpm build` must regenerate
`packages/create-threenative/capabilities.json` with the new `RenderChain` entry in the same
commit — a capability absent from the manifest does not exist to the agents that build with it.
