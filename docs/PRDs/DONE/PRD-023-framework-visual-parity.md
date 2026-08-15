---
prd_contract: v1
---

# PRD-023 — Framework visual parity: keep the route visible

**Status:** Complete; final13 blind comparison beats the vanilla visual baseline.

**Complexity:** 5 → MEDIUM mode (4 template files +2, user-facing visual behavior +1,
multi-surface verification +2).

**Problem:** the fresh framework arm was functionally green but visually behind the vanilla
baseline: its finish camera hid route context and its camera was too side-on for a third-person
platformer.

**Files analyzed:** `docs/verification/round-1-2026-08-06.md`,
`docs/verification/platformer-round-1-final-comparison.png`,
`packages/create-threenative/templates/starter/src/render/camera.ts`,
`packages/create-threenative/templates/starter/src/scenes/Play.ts`,
`packages/create-threenative/templates/starter/src/ui/App.tsx`,
`packages/create-threenative/templates/starter/src/ui/Hud.tsx`,
`scripts/sweep-capture.ts`, `scripts/sweep-judge.ts`.

**Current behavior:**

- The final framework start frame uses a behind/above route composition with coins, gaps,
  spikes, goal, HUD, and restart path visible.
- The final framework completion frame keeps the player, gate/banner, spikes, route gaps, and
  green 8/8 completion HUD in view.
- Final13 blind averages are framework 4.5/5 visuals and vanilla 3.5/5; playability is 4.0/5
  versus 3.0/5.
- The framework charter keeps materials, camera look, lighting, and post-processing in generated
  user source; this PRD edits the shipped starter source, never a package-level visual option.

## Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
|---|-----------|-------------------------------------|----------|-------------------|------------------|
| 1 | Starter route-preserving camera composition | `packages/create-threenative/templates/starter/src/scenes/Play.ts:38` calls `createSpringArm` | oversized or context-losing default framing | yes, defaults are tightened in the same phase | `command: pnpm sweep:proof docs/benchmark/sweeps/<framework-archive>`; result: RED observed: camera assertion fails when the starter offset exceeds the 12-unit bound; exit: 1 |
| 2 | Finish-state HUD composition | `packages/create-threenative/templates/starter/src/ui/App.tsx:14` mounts `Hud` over `GameCanvas` | completion treatment that occludes the active route | yes, old overlay treatment is replaced | `command: pnpm sweep:capture docs/benchmark/sweeps/<framework-archive>`; result: RED observed: capture guard rejects a blank or HUD-only finish frame; exit: 1 |
| 3 | Blind visual parity record | `scripts/sweep-judge.ts:142` validates the image bundle and critic input | unscored visual opinion | n/a | `command: pnpm sweep:judge docs/verification/blind-platformer-round-1-final --input docs/verification/platformer-round-1-final-critic.json`; result: RED observed: arm identifier or missing sample voids the judge; exit: 1 |

**How will this feature be reached?**

- [x] Entry point: generated starter scene frame loop and the round capture/judge commands.
- [x] Pre-existing file edited to call it: `packages/create-threenative/templates/starter/src/scenes/Play.ts:38`.
- [x] Registration/wiring: `App` already mounts `Hud` above `GameCanvas` at `App.tsx:14`; no
  new package registration is permitted.

**Full flow:**

1. A fresh framework sandbox scaffolds the starter source.
2. `Boot` enters `Play`, which creates and follows the player camera.
3. The player reaches the route goal and `Hud` renders the completion state.
4. `sweep:proof`, `sweep:capture`, and the blind judge observe the route, player, HUD, and goal.

**What does this replace?**

- [x] Replaces the starter’s current camera/HUD composition in the named template files.
- [x] Does not introduce a framework render abstraction or a `defineGame` visual option.

## 4. Execution Phases

#### Phase 1: Route-preserving starter composition - the finish frame keeps the player, goal, and route readable

**Files (4):**

- `packages/create-threenative/templates/starter/src/render/camera.ts` - EDIT: tighten the
  default target-relative offset and document the visual framing invariant.
- `packages/create-threenative/templates/starter/src/scenes/Play.ts` - EDIT: keep the live
  camera caller on the route and reapply the composition after respawn/goal transitions.
- `packages/create-threenative/templates/starter/src/ui/Hud.tsx` - EDIT: reduce completion
  overlay dominance while retaining an obvious completion and restart affordance.
- `packages/create-threenative/templates/starter/playtests/look.playtest.json` - EDIT: assert
  player visibility and camera follow in the generated starter flow.

**Implementation:**

- [x] Preserve all look code in generated `src/render/` and `src/ui/`; do not add package API
  knobs for materials, shaders, lighting, camera style, or post-processing.
- [x] Make the default camera target-relative distance stay within the sealed semantic budget
  while keeping the player and next platform visible.
- [x] Make the finish card occupy a bounded region; the goal, player, and at least one route
  element remain visible behind it.

**Wiring (the phase is not done without this):**

- [x] Caller edited: `packages/create-threenative/templates/starter/src/scenes/Play.ts:38`
  invokes the updated camera composition.
- [x] Registration: `packages/create-threenative/templates/starter/src/ui/App.tsx:14` keeps
  the HUD in the real render/UI flow.
- [x] Old path: old default camera/HUD treatment is replaced in the same generated source.
- [x] Ledger rows filled: #1 and #2.

**Tests Required:**

| Test File | Test Name | Assertion | Negative control (must be observed red) |
|-----------|-----------|-----------|-----------------------------------------|
| `packages/create-threenative/templates/starter/playtests/look.playtest.json` | `starter keeps player visible while camera follows` | camera and player assertions pass in a headed WebGPU run | set the camera offset beyond the bound; the same scenario fails |
| sealed platformer proof | `platformer run retains route context at completion` | proof remains 2/2 and the finish screenshot keeps goal/player context | remove the finish-state camera update; camera or visibility assertion fails |
| `scripts/sweep-capture.ts` | `captureSweep validates finish frames` | guarded before/after images contain rendered scene content | replace the finish image with a HUD-only frame; capture exits non-zero |

**Revert check:**

- Disable the updated camera/HUD source, rerun the same headed capture, and confirm the prior
  close-up/occluded finish frame returns; the visual comparison must move back toward the current
  3.0/5 framework baseline.

**User Verification:**

- Action: build a fresh framework platformer from the starter and play through the goal.
- Expected: the player, goal, and route remain legible at completion; the HUD confirms success
  without covering the whole scene.

#### Phase 2: Blind visual checkpoint - the framework sample reaches parity or better

**Files (3):**

- `scripts/sweep-capture.ts` - EDIT: preserve labeled capture metadata for start and finish
  frames without leaking arm identity into the blind bundle.
- `scripts/sweep-judge.ts` - EDIT: retain bounded visual/playability scores and comparison
  rationale for the fresh critic.
- `docs/verification/round-1-2026-08-06.md` - EDIT: record the new framework and vanilla
  visual scores, gap disposition, and evidence paths.

**Implementation:**

- [x] Capture both arms at the same viewport and equivalent start/finish states.
- [x] Build a metadata-free blind bundle and obtain a fresh critic response.
- [x] Record framework visual average >= vanilla visual average, or keep the gap open with a new
  evidence-backed disposition.

**Wiring (the phase is not done without this):**

- [x] Caller edited: `scripts/sweep-capture.ts:89` runs the capture path used by the round.
- [x] Registration: `scripts/sweep-judge.ts:142` validates the bundle before accepting scores.
- [x] Old path: manual visual claims are replaced by the blind bundle and judge record.
- [x] Ledger rows filled: #3 and the round visual column.

**Tests Required:**

| Test File | Test Name | Assertion | Negative control (must be observed red) |
|-----------|-----------|-----------|-----------------------------------------|
| `scripts/__tests__/sweep-judge.spec.ts` | `rejects arm leakage and incomplete samples` | blind judge accepts only bounded, anonymous samples | add an arm name to the critic input; judge exits non-zero |
| `docs/verification/round-1-2026-08-06.md` | `records visual evidence` | bundle, reveal, critic, and judge paths are named | remove the blind-bundle note; round resume check reports incomplete evidence |

**Revert check:**

- Restore the prior starter camera/HUD composition and rerun the same bundle; the framework
  visual score must return to the recorded baseline or the comparison is not measuring the edit.

**User Verification:**

- Action: open the neutral comparison composite and the judge record.
- Expected: the framework finish frame is at least as readable and screenshot-worthy as the
  vanilla finish frame.

## Negative Controls

| Gate | Negative control | Expected red | Exact command/result |
|---|---|---|---|
| typecheck | remove the generated camera export or break its caller | starter build/typecheck exits non-zero | `command: pnpm typecheck`; result: RED observed: starter camera caller no longer typechecks; exit: 1 |
| sealed proof | set the camera offset beyond the semantic bound | headed proof reports a camera assertion failure | `command: pnpm sweep:proof docs/benchmark/sweeps/<framework-archive>`; result: RED observed: camera follow assertion fails; exit: 1 |
| capture guard | substitute a mostly blank finish frame | capture exits non-zero | `command: pnpm sweep:capture docs/benchmark/sweeps/<framework-archive>`; result: RED observed: TN_CAPTURE_BLANK; exit: 1 |
| blind judge | include an arm name in critic input | judge voids the comparison | `command: pnpm sweep:judge docs/verification/blind-platformer-round-1-final --input docs/verification/platformer-round-1-final-critic.json`; result: RED observed: TN_JUDGE_VOID; exit: 1 |

## Acceptance Criteria

- [x] A fresh framework platformer renders a visually coherent route with player, goal, and
  meaningful environmental context in both start and finish frames.
- [x] The finish HUD communicates completion without obscuring the route, goal, or player.
- [x] Headed sealed proof remains green; no visual change weakens movement, goal, HUD, or camera
  assertions.
- [x] A fresh blind critic scores framework visuals at least equal to vanilla visuals, or the
  round remains open with the gap explicitly recorded.
- [x] No package API owns materials, shaders, lighting, camera style, or post-processing.

## Checkpoint Protocol

1. After Phase 1, run `pnpm typecheck`, the starter build, and headed platformer proof. Record
   the exact output, screenshot paths, caller lines, and one observed-red result per gate.
2. After Phase 2, run guarded capture for both arms, create the metadata-free bundle, obtain a
   fresh critic, and run `pnpm sweep:judge`.
3. Do not mark the visual gap closed from a green build alone. The consumer evidence is the
   anonymous start/finish image comparison plus the sealed proof.
4. If framework visuals remain below vanilla, keep the PRD active and open the next smallest
   visual disposition; do not add a framework look abstraction to force a score.

## Verification Evidence

Status: Complete. Final framework archive `docs/benchmark/sweeps/platformer-2026-08-07-50`
passes sealed proof 2/2. Final blind bundle/judge:
`docs/verification/blind-platformer-round-1-final13/judge.json`; framework averages 4.5/5
visuals and 4.0/5 playability versus vanilla 3.5/5 and 3.0/5. The final completion frame keeps
the player, goal, spikes, route gaps, and 8/8 HUD visible.

Contract conformance: prd_contract: v1
