---
prd_contract: v1
---

# PRD-267 — screen-space GI, reflections and their denoiser ship in the templates

**Status:** PROPOSED — filed 2026-08-29, measured at `7e5a9fe1`. Depends on
[PRD-266](./PRD-266-the-render-chain-names-the-tier-it-actually-ran.md). Batch:
[docs/PRDs/lighting](./README.md).

**Updated 2026-08-30.** The abstraction PRD-266 ships is named `WorldEnvironment`, after
Godot's node of the same name; the invented `RenderChain` is withdrawn. A working prototype
of the whole chain now exists in `../sandbox/lumen-hall` — evidence in
[docs/verification/lighting-chain-2026-08-30.md](../../verification/lighting-chain-2026-08-30.md)
— and the per-template numbers below should start from what it measured rather than from
upstream's generic presets.

**Goal: a scaffolded game looks lit by bounced light on the first run, from source the game owns
and can delete.** This is the adopt-upstream half of the batch evaluation: no code is vendored,
nothing new is installed, and every appearance decision lands in generated user source.

**Complexity:** seven template files with per-template tuning, plus baselines = **LOW** in
mechanism, **MEDIUM** in taste. No package code. No new dependency.

## The problem, measured at `7e5a9fe1`

All seven templates ship the same lighting recipe: four analytic lights
(`templates/starter/src/render/lighting.ts` — hemisphere, key with shadows, rim, ambient) and
bloom-only post. It is a good recipe and it is the ceiling of what analytic lights reach: no
surface is lit by the surface next to it, so a red wall never tints the white floor beside it, and
an unlit interior corner reads as flat ambient rather than as shadow with bounce in it.

Meanwhile `three@0.185.1` — already the catalog dependency — ships all of this in
`three/addons/tsl/display/`, WebGPU, MIT, uninstalled effort:

| Node | What it buys |
| --- | --- |
| `SSGINode` | Screen-space diffuse GI. Its docblock cites `cdrinmatane/SSRT3` and exposes the same `sliceCount`/`stepCount` presets. |
| `SSRNode` | Screen-space reflections |
| `GTAONode` | Ground-truth ambient occlusion, contact darkening SSGI does not resolve |
| `DenoiseNode` / `RecurrentDenoiseNode` / `BilateralBlurNode` | Removes the sample noise both of the above produce |
| `TRAANode` | Temporal resolve |
| `GodraysNode` | Raymarched godrays. Its docblock recommends a bilateral blur after it. |
| `ClusteredLighting` / `DynamicLighting` (`three/addons/lighting/`) | Forward+ clustering for many emissive lights; batched light uniforms so adding a light stops recompiling materials |

None of this is reachable today because there is no chain to install it into and no way to
degrade it — which is PRD-266, and why this PRD depends on it.

## What ships

`templates/*/src/render/postprocessing.ts` in each of the seven templates, rewritten to build a
`WorldEnvironment` **request** rather than a hand-composed node expression, keeping the existing
file-header contract (*"Generated for you: ordinary Three.js; ThreeNative does not read this
file."*) and its comment density — these files teach as much as they configure.

Per-template, because the look is the point and one preset for seven genres is the preset system
the charter closed with evidence:

- **starter, minimal** — GTAO + SSGI at the low preset, denoise, bloom. Cheap enough for the
  first-run machine; the point is that bounce is visible, not that it is maximal.
- **action-rpg** — SSGI medium, SSR on the floor materials, godrays through the sky rig.
- **shooter** — SSGI low with TRAA; frame time is the constraint, and this template already owns
  the tightest capture tolerance in the visuals gate.
- **platformer, defense, racing** — SSGI low, GTAO, no SSR. Stylised palettes get little from
  reflections and pay full price.

`lighting.ts` in each gains the `ClusteredLighting` opt-in **commented, with the numbers that make
it worth switching on** — the existing four-light rig stays the default because it is correct for
four lights.

Every knob lives in these files. `packages/core` gains nothing in this PRD.

## Acceptance criteria

1. **A scaffolded template renders bounced light on the browser lane.** For each of the seven
   templates, a playtest scenario asserts `worldEnvironment.tier` is not `off` and the SSGI stage is in
   `chain.applied`. *Mutation:* remove the SSGI request from the template's `postprocessing.ts` and
   the scenario fails naming the missing stage — not a screenshot diff, which colour drift alone
   could satisfy.

2. **The visual change is baselined, not asserted by eye.** `pnpm visuals:baseline` is regenerated
   in the same commit and `pnpm visuals` is green afterwards; the A/B pair
   (`pnpm visuals:ab`) is pasted in the verification record so the before/after is inspectable.
   *Mutation:* none — this is a record criterion, and an unpasted A/B fails review.

3. **Deleting the file still boots the game.** With `postprocessing.ts` emptied to a no-op, each
   template still reaches a non-blank capture. *Mutation:* make any package-side code read a symbol
   from `postprocessing.ts` and the delete-the-file spec fails, which is the charter's
   "can the game change the appearance completely without editing package code?" test made
   executable.

4. **`pnpm test:templates` is green on every template, not just up to the first failure.** The
   known capture-lane red in the shooter template
   (`TN_CAPTURE_BLANK 0.01987`, which aborts the gate before `starter` is reached) must be
   diagnosed or explicitly quarantined **before** this PRD's green is claimed. A gate that stops
   early has not tested what it did not reach.

5. **The frame cost is measured, not assumed.** Each template's `render` phase from
   `TN_FRAME_BUDGET` is recorded before and after, on the browser lane, at a fixed resolution.
   A template whose `render` phase more than doubles drops to the next tier down in its own
   `postprocessing.ts` and the number is recorded. Desktop A/Bs read `render.p50`, never fps — the
   Xvfb present throttle makes desktop fps meaningless.

## Out of scope

Off-screen bounce (PRD-268 — SSGI cannot do it, and this PRD's output is what makes that gap
visible). Motion vectors (PRD-269): until they land, TRAA is requested only on templates without
skinned characters, and the reason is written in the file.

## Verification

`pnpm typecheck && pnpm lint && pnpm test`, then `pnpm test:templates` end-to-end,
`pnpm visuals`, and the per-template frame-budget table. Native lanes are PRD-270's gate; this PRD
does not claim a platform it did not execute.
