---
prd_contract: v1
---

# PRD-092 — A `defense` starter kit: the strategy genre without the WASM dependency that would make it web-only

**Status: IMPLEMENTED; generated browser evidence recorded 2026-08-12.** Desktop execution is
covered by the batch record; no mobile readiness is claimed.
**Parent:** [PRD-087](./PRD-087-genre-borrow-ledger.md).
**Depends on:** [PRD-088](../BLOCKED/requires-ray-measurement/PRD-088-physics-spatial-queries.md),
[PRD-091](./PRD-091-genre-kit-delivery-rail.md).
**Sequenced after:** [PRD-090](./PRD-090-racing-starter-kit.md) — it consumes 090's measurement.

**Complexity: 6 → HIGH mode.** No package code proposed, but this kit forces a decision that
PRD-087 deferred and PRD-090 measured.

## 1. Why this is user value and not tidying

The strategy genre is the one where an honest framework and a demo diverge hardest, because the
obvious build is **web-only by construction**.

`@threenative/physics/navigation` — `NavigationAgent3D`, `NavigationRegion3D`,
`NavigationObstacle3D` — carries a WASM dependency, and Android runs QuickJS. A kit whose units
pathfind through a navmesh would boot beautifully in a browser and be missing on half the
platforms we ship. That is the definition of an unfinished feature here, and it would ship as
our flagship strategy example.

So this kit is scoped by that constraint rather than around it: **tower defense**, where the
attackers follow an authored route and the player's decisions are placement and economy. The
shipped platformer already uses template-local steering for exactly this reason. Scoping the
genre to what runs on every target is the point, not a compromise, and the kit says so in its
own README so the user learns the constraint rather than tripping over it later.

**The second reason is `PathFollow3D`.** PRD-087 set a countable promotion rule: three
hand-rolled route-following sites and it enters core. `Chaser.ts:22-24` is site one. PRD-090's
driveline is site two. **This kit's attacker route is site three.** If PRD-090's recorded line
count came in above 20, this PRD is what triggers the promotion — and the promotion happens
here, in this PRD's Phase 1, with all three copies deleted in the same commit. If it came in
under 20, rule 1 has already closed the question and this kit writes its own eight lines like
everyone else.

Either way the rule executes instead of ageing. That is why this kit is sequenced third rather
than by preference.

## 2. Solution

`packages/create-threenative/templates/defense/` plus a `kit.json`.

### The game

A route from a spawner to a base. Attackers walk it in waves. You spend income on towers placed
on buildable ground; towers acquire and shoot on their own. **Win condition: survive ten waves.
Fail condition: twenty attackers reach the base.** Both counters are on the HUD from the first
frame.

### What is borrowed, and from where

| Kit file | Borrowed from | The idea |
|---|---|---|
| `src/towers/Tower.ts` | OpenRA `Traits/AutoTarget.cs`, `Armament.cs` | acquire on a jittered scan, not per frame; a weapon with its own reload clock |
| `src/towers/targeting.ts` | OpenRA `AutoTarget.cs` priority filtering | nearest-first is one policy among several; the policy is a function the user swaps |
| `src/attackers/Attacker.ts` | 0 A.D. `Formation.js`, SuperTuxKart `drive_graph.cpp` | follow the authored route with a lateral offset so a group reads as a group |
| `src/waves.ts` | OpenRA `Traits/ActorSpawner.cs`, 0 A.D. `ProductionQueue.js` | waves are a schedule with composition, not a spawn-on-death reflex |
| `src/economy.ts` | 0 A.D. `ResourceTrickle.js`, `Cost.js` | income trickles; every placement has a stated cost |
| `src/placement/Buildable.ts` | 0 A.D. `BuildRestrictions.js`, `Foundation.js` | placement is validated against ground rules before it is committed |
| `src/ui/` | 0 A.D. `GuiInterface.js` | the HUD reads a projection of game state, and never reaches into entities |

Placement uses `ScenePicker` — that is what it is for — and validation uses PRD-088's
`intersectShape` to reject a tower overlapping the route or another tower. **Marquee selection
is not in this kit**; PRD-087 scored selection-and-command at 50/100 and rejected it, and a
tower-defense kit does not need it. Adding it here to feel more like an RTS would be building
the rejected thing under a different name.

### Fog of war is not here, and that is the rule working

Three of seven surveyed codebases implement fog of war, and PRD-087 rejected it at 44/100
because it is literally what a screenshot shows. It is not in this kit either — not because it
could not be written as kit source, but because a tower-defense board is meant to be read at a
glance and a shroud would be decoration borrowed from a different game. If a user wants it,
every line they would need is already under their `src/render/`.

### Looking good

Same gate as every kit: six `RENDER_LAYER_FILES` with live importers, ≤6-colour palette with
exactly one `accent`, `materials.ts` and `sky.ts` importing `palette.js`, key and rim
`DirectionalLight` plus fill, `PCFSoftShadowMap`, `normalBias`, and `toneMapping` /
`toneMappingExposure` / `setOutputNode` / `bloom(` in post — then a blind score ≥
`VISUAL_SCORE_FLOOR = 4`.

The camera is a fixed angled overhead in `src/render/camera.ts`. A strategy board is the one
genre where the framing *is* the readability, so it ships as user source like everything else a
screenshot shows.

### What this kit deliberately does not ship

- **No navmesh pathfinding**, for the reason in §1. The README says why.
- **No fog of war**, no marquee selection, no unit production, no tech tree.
- **No stat modifier stack.** Tower upgrades replace a stats object; they do not compose layers.
- **No AI opponent.** Waves are a schedule.

## 3. Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `templates/defense/` + `kit.json` | PRD-091's loader; `npx` and Studio picker | no strategy genre exists | n/a | scaffold; the playtest must reach assertions |
| 2 | Route following, site three | `src/attackers/Attacker.ts` | either two hand-rolled copies, or nothing | **conditional** — if PRD-090 measured >20 lines, `PathFollow3D` lands in core and **all three copies are deleted here** | promote without deleting the copies → the duplication the rule exists to stop survives |
| 3 | Placement validation over `intersectShape` | `src/placement/Buildable.ts` | nothing validates placement | n/a | place a tower on the route → must be rejected |
| 4 | Tower acquisition over `intersectShape` | `src/towers/Tower.ts` | the hardcoded-reference pattern | n/a | give a tower a direct reference → identical with one attacker, divergent with a wave |
| 5 | Wave + economy + lose condition | `src/waves.ts`, `src/economy.ts`, `src/state.ts` | no shipped kit models an economy | n/a | remove the leak counter → the fail assertion cannot pass |

Row 2 is the reason this PRD is sequenced where it is. **A promotion that leaves the copies
behind is a net addition of code and fails the kill switch.**

## 4. Execution phases

### Phase 0 — Scaffold and boot, empty board

**Outcome:** `--template defense` installs, type-checks, builds web and native bundles, boots to
a lit board with a visible route and no gameplay.
**Gate:** `pnpm test:templates` green; native single-file assertion green; visual gate
structural pass.

### Phase 1 — Resolve `PathFollow3D`, then move the attackers

**Outcome:** PRD-090's recorded number is read and acted on — promote into `@threenative/core`
and delete all three copies, or write the kit's own follower. **The branch is decided by the
recorded number, not by discussion.**
**Gate:** if promoted, `Chaser.ts`, PRD-090's driveline and this kit all import the core node,
their local copies are gone, and both prior kits' playtests are still green. If not promoted,
this file records the number that closed it.

### Phase 2 — Towers, targeting, waves

**Outcome:** placement, acquisition, firing, waves, income, win and fail.
**Gate:** playtests for a survived wave and a leaked wave, each asserting the counters.

### Phase 3 — Looks, scored blind

**Gate:** blind score ≥ 4. Below the floor is a red phase, not a note.

### Phase 4 — Studio and device

**Gate:** `pnpm studio:probe --browser` green with the kit listed; `--target android` and
`--target ios` executed or explicitly recorded as not executed.

## 5. Verification strategy

- **The no-WASM claim is asserted, not stated.** A test asserts the kit's `src/` imports nothing
  from `@threenative/physics/navigation`, and the native bundle build is the second proof.
- **Placement rejection has its own assertion.** Attempt a tower on the route and a tower
  overlapping another; assert both refused and income unchanged. A validator that always
  accepts passes every "I placed a tower" test.
- **The scan interval is asserted as a count** over 300 frames, inside the jitter window — a
  per-frame scan passes behaviourally and fails only here.
- **Both outcomes are asserted**, not just the win: one playtest survives ten waves, another
  deliberately leaks twenty and asserts the fail transition.
- **Economy is asserted as a ledger**: income over N frames plus spend equals balance. A
  free-tower bug passes any test that only checks a tower appeared.
- **`--browser-recipe webgpu`, `xvfb-run -a -s '-screen 0 1600x900x24'` for visuals.**

## 6. Acceptance criteria

- [ ] The kit ships as a directory plus a `kit.json` — no CLI file, no gate script edited.
- [ ] `npx` and the Studio picker produce byte-identical trees.
- [ ] It boots to a game with a win and a fail condition on the HUD.
- [ ] `src/` imports nothing from `@threenative/physics/navigation`, asserted by a test, and the
      native bundle builds.
- [ ] PRD-087's `PathFollow3D` row is **closed** by this PRD — promoted with all three copies
      deleted, or closed permanently with PRD-090's recorded number. It does not stay open.
- [ ] Placement validation rejects the route and overlaps, asserted.
- [ ] Visual gate passes structurally; blind score **≥ 4**.
- [ ] No fog of war, no marquee selection, no navmesh, no tech tree was added anywhere.
- [ ] `src/game.ts` runs on desktop native; React stays in `src/main.ts`.
