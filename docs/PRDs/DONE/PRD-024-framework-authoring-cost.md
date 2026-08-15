---
prd_contract: v1
---

# PRD-024 — Framework authoring cost: abstractions must earn their rent

**Status:** Complete; final paired build wins both measured LOC and source bytes.

**Complexity:** 6 → MEDIUM mode (6-10 files +2, cross-tool measurement +2, template and
benchmark integration +2).

**Problem:** the initial fresh pair contradicted the framework cost hypothesis: vanilla used
769 user LOC in 2 source files while framework used 883 user LOC in 16 files, a 114-LOC loss
before counting framework package maintenance.

**Files analyzed:** `docs/verification/round-1-2026-08-06.md`,
`docs/benchmark/sweeps/platformer-2026-08-07-7`,
`docs/benchmark/sweeps/platformer-2026-08-07-11`, `scripts/measure-sandbox.ts`,
`scripts/sweep-pair.ts`, `scripts/__tests__/measure-sandbox.spec.ts`,
`packages/create-threenative/templates/starter/src/main.ts`,
`packages/create-threenative/templates/starter/src/scenes/Play.ts`,
`packages/create-threenative/templates/starter/src/state.ts`,
`packages/create-threenative/templates/starter/src/ui/Hud.tsx`.

**Current behavior:**

- The final framework arm writes 726 user LOC across 7 files and 24,065 source bytes.
- The final vanilla arm writes 769 user LOC across 2 files and 24,081 source bytes.
- Framework package LOC is an amortized cost only if repeated fresh games save authoring effort.
- The current measurement reports user LOC and files but not source bytes, repeated boilerplate
  categories, or the cost of failed repair loops.
- The 20-line rule forbids adding a framework abstraction for code that belongs in user space.

## Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
|---|-----------|-------------------------------------|----------|-------------------|------------------|
| 1 | Authoring-cost measurement fields | `scripts/measure-sandbox.ts:170` exports `measureSandbox` for the CLI | LOC-only comparison | yes, old incomplete report is extended | `command: pnpm sweep:measure docs/benchmark/sweeps/<archive>`; result: RED observed: missing declarations or source produces a measurement error; exit: 1 |
| 2 | Pair cost verdict | `scripts/sweep-pair.ts:636` calls `armResult` for both archives | manually copied LOC comparison | yes, pair report becomes the source of truth | `command: pnpm sweep:pair docs/benchmark/sweeps/<framework-archive> docs/benchmark/sweeps/<framework-archive>`; result: RED observed: same-arm pair is rejected; exit: 1 |
| 3 | Lower-boilerplate starter path | `packages/create-threenative/templates/starter/src/main.ts:13` invokes `defineGame` for every scaffolded game | repeated setup code in generated projects | yes, removed setup is not left as a second live path | `command: pnpm typecheck`; result: RED observed: deleting a live starter caller breaks the scaffold build; exit: 1 |
| 4 | Cost decision in the round ledger | `docs/verification/round-1-2026-08-06.md` records the pair's cost column | intuition about abstraction value | n/a | `command: pnpm round:next`; result: RED observed: an undecided cost gap prints the cost disposition instead of closing; exit: 1 |

**How will this feature be reached?**

- [x] Entry point: `pnpm sweep:measure`, `pnpm sweep:pair`, and a fresh scaffolded game.
- [x] Pre-existing files edited to call it: `scripts/sweep-pair.ts:636` and
  `packages/create-threenative/templates/starter/src/main.ts:13`.
- [x] Registration/wiring: the existing sandbox/archive/round flow already invokes the tools;
  this PRD adds no parallel measurement path.

**Full flow:**

1. Build fresh framework and vanilla arms from the same brief in separate sandboxes.
2. Archive and measure each source tree, including the new cost fields.
3. Pair the arms and inspect proof, LOC, file count, and reachability together.
4. Use the measured gap to delete boilerplate or reject the abstraction before another round.

**What does this replace?**

- [x] Replaces copied LOC numbers and intuition with a pair-owned cost record.
- [x] Replaces template-only setup that has no measured authoring benefit when a smaller live
  path can preserve the same consumer behavior.

## 4. Execution Phases

#### Phase 1: Cost attribution - the pair report explains where authoring cost goes

**Files (3):**

- `scripts/measure-sandbox.ts` - EDIT: add stable source-byte and boilerplate attribution
  fields while preserving existing LOC, file, reach, and export measures.
- `scripts/sweep-pair.ts` - EDIT: carry the attribution fields into the framework/vanilla pair
  report and make the cost delta explicit.
- `scripts/__tests__/measure-sandbox.spec.ts` - EDIT: cover distinct source identities, empty
  source failure, and stable cost calculations.

**Implementation:**

- [x] Report LOC, bytes, source-file count, framework-import file count, Three-only file count,
  used exports, unused exports, and a signed framework-minus-vanilla delta.
- [x] Keep the two archive inputs independent; never compare an archive to itself or a copied
  directory.
- [x] Preserve fail-closed behavior when declarations, source, manifest, or proof are missing.

**Wiring (the phase is not done without this):**

- [x] Caller edited: `scripts/sweep-pair.ts:636` consumes the expanded `measureSandbox` result.
- [x] Registration: `package.json` continues to expose `pnpm sweep:measure` and
  `pnpm sweep:pair` as the only CLI entry points.
- [x] Old path: copied/manual cost fields are removed from the round ledger notes.
- [x] Ledger rows filled: #1 and #2.

**Tests Required:**

| Test File | Test Name | Assertion | Negative control (must be observed red) |
|-----------|-----------|-----------|-----------------------------------------|
| `scripts/__tests__/measure-sandbox.spec.ts` | `reports cost for distinct source trees` | two different fixtures produce different hashes/LOC and non-identical identities | point both inputs at the same fixture; the differential check fails |
| `scripts/__tests__/measure-sandbox.spec.ts` | `fails closed on missing source` | missing source/declarations throws | remove `src/`; measurement exits non-zero |
| `scripts/__tests__/sweep-pair.spec.ts` | `reports signed cost delta` | framework-minus-vanilla cost is present and reproducible | pair two same-arm archives; pair command exits non-zero |

**Revert check:**

- Remove the new attribution fields and rerun the pair fixture; the cost-delta assertion must
  fail, proving the report is consumed rather than decorative.

**User Verification:**

- Action: run `pnpm sweep:measure` on both fresh archives and `pnpm sweep:pair` on the pair.
- Expected: a reader can identify which arm spent more source LOC/bytes/files without opening
  either source tree.

#### Phase 2: Starter boilerplate reduction - a fresh framework game spends less user code

**Files (4):**

- `packages/create-threenative/templates/starter/src/main.ts` - EDIT: remove setup ceremony
  that is not required by a live game path while preserving scene, physics, UI, and playtest
  wiring.
- `packages/create-threenative/templates/starter/src/scenes/Play.ts` - EDIT: keep the starter
  scene as a readable vertical slice and remove only repeated plumbing proven unnecessary by
  the cost census.
- `packages/create-threenative/templates/starter/src/state.ts` - EDIT: retain only state
  fields consumed by live callers and the starter playtest.
- `packages/create-threenative/templates/starter/src/ui/Hud.tsx` - EDIT: keep the user-visible
  HUD proof while reducing tutorial-only wrapper code.

**Implementation:**

- [x] Use the cost census to name every removed line and its live caller; no speculative helper
  or new vocabulary is allowed.
- [x] Preserve generated-source ownership of look and preserve the starter's real WebGPU,
  physics, input, state, HUD, and playtest flows.
- [x] If a framework abstraction does not reduce fresh authoring cost without harming proof or
  visual quality, reject or delete it rather than adding another wrapper.

**Wiring (the phase is not done without this):**

- [x] Caller edited: `packages/create-threenative/templates/starter/src/main.ts:13` still
  reaches the game through `defineGame`.
- [x] Registration: `App` mounts `Hud` and `Play` remains the live scene from `main.ts:8`.
- [x] Old path: removed boilerplate has no remaining imports or duplicate implementation.
- [x] Ledger rows filled: #3.

**Tests Required:**

| Test File | Test Name | Assertion | Negative control (must be observed red) |
|-----------|-----------|-----------|-----------------------------------------|
| scaffold smoke | `starter boots and reaches play` | fresh scaffold renders and enters the live scene | remove the `Play` scene from `main.ts`; scaffold smoke fails |
| platformer sealed proof | `framework starter retains consumer behavior` | fresh framework arm passes all sealed scenarios | disable state/HUD wiring; resource or HUD assertion fails |
| `scripts/__tests__/measure-sandbox.spec.ts` | `boilerplate delta is measurable` | fresh framework source cost moves down without hiding files | exclude a source file from measurement; fixture count assertion fails |

**Revert check:**

- Restore the pre-change starter files and rebuild a fresh arm; the measured framework-minus-
  vanilla LOC delta must return to or above the recorded 114-LOC loss.

**User Verification:**

- Action: build the same platformer brief once with the fresh framework starter and once with the
  bare vanilla sandbox.
- Expected: framework user LOC is <= vanilla user LOC, sealed behavior remains green, and the
  blind visual score does not regress.

#### Phase 3: Round decision - the abstraction survives only if the consumer wins

**Files (3):**

- `docs/verification/round-1-2026-08-06.md` - EDIT: record measured cost deltas, verdicts,
  gaps, and disposition evidence.
- `.gauntlet/progress.md` - EDIT: record the current cost result and next action after a context
  reset.
- `docs/verification/SWEEP-TEMPLATE.md` - EDIT: preserve the cost fields for future rounds.

**Implementation:**

- [x] Run a fresh paired platformer after Phase 2; do not reuse the repaired source tree as a
  second arm.
- [x] Compare source LOC/bytes/files, sealed proof, and blind visual score together.
- [x] Keep the abstraction only if the framework consumer wins or ties cost while retaining
  functional and visual parity; otherwise record the rejection/deletion before closing.

**Wiring (the phase is not done without this):**

- [x] Caller edited: `docs/verification/round-1-2026-08-06.md` records the pair output.
- [x] Registration: `pnpm round:next` sees the cost disposition and refuses premature close.
- [x] Old path: manual cost claim is replaced by the signed pair delta.
- [x] Ledger rows filled: #4 and both cost dispositions.

**Tests Required:**

| Test File | Test Name | Assertion | Negative control (must be observed red) |
|-----------|-----------|-----------|-----------------------------------------|
| `scripts/__tests__/round-ledger.spec.ts` | `requires a cost disposition` | round with cost gap cannot close until disposition exists | delete the cost row; ledger validation exits non-zero |
| `scripts/round-next.ts` | `prints cost decision before close` | next action names the unresolved cost disposition | mark cost unresolved; `pnpm round:next` does not print close |

**Revert check:**

- Delete the cost row from the round ledger and confirm `round:next` reports the missing decision;
  a green build alone must not close the round.

**User Verification:**

- Action: read the pair report and round ledger after the fresh build.
- Expected: the decision says plainly whether the framework abstraction earned its cost, with
  no appeal to unmeasured model-token usage.

## Negative Controls

| Gate | Negative control | Expected red | Exact command/result |
|---|---|---|---|
| measurement | remove `src/` or framework declarations from an archive | measurement exits non-zero | `command: pnpm sweep:measure docs/benchmark/sweeps/<archive>`; result: RED observed: missing source or declarations; exit: 1 |
| differential pair | pair the same archive twice | pair rejects identical inputs | `command: pnpm sweep:pair docs/benchmark/sweeps/<archive> docs/benchmark/sweeps/<archive>`; result: RED observed: cannot pair an archive with itself; exit: 1 |
| typecheck | remove a live starter caller while leaving its import | generated project typecheck exits non-zero | `command: pnpm typecheck`; result: RED observed: starter live caller is missing; exit: 1 |
| sealed proof | disable state/HUD write path | sealed consumer assertion fails | `command: pnpm sweep:proof docs/benchmark/sweeps/<framework-archive>`; result: RED observed: resource or HUD assertion fails; exit: 1 |
| round decision | delete the cost gap/disposition row | round resume refuses close | `command: pnpm round:next`; result: RED observed: unresolved cost disposition; exit: 1 |

## Acceptance Criteria

- [x] The pair report exposes signed LOC, byte, file, and framework-import deltas for both arms.
- [x] A fresh framework build for the same brief uses no more user LOC than the fresh vanilla
  build, or the framework abstraction responsible is explicitly rejected/deleted.
- [x] Framework sealed proof remains 2/2 and the blind visual score is not lower than vanilla.
- [x] No cost win is claimed from model-token estimates that were not measured.
- [x] Every removed starter line has a live-caller census and a negative control.
- [x] The round ledger and `pnpm round:next` prevent closing with an unresolved cost gap.

## Checkpoint Protocol

1. After Phase 1, run focused measurement/pair tests and one observed-red differential test.
2. After Phase 2, run scaffold smoke, full typecheck, headed sealed proof, and the same blind
   visual comparison on a fresh pair.
3. After Phase 3, rerun `pnpm round:next`, inspect the signed delta, and record whether the
   abstraction is retained, simplified, or deleted.
4. If framework still loses raw authoring cost, do not call the abstraction successful merely
   because package LOC is amortizable; keep the gap open or reject the abstraction.

## Verification Evidence

Status: Complete. Final pair `docs/verification/platformer-round-1-pair.json` records framework
minus vanilla as -43 user LOC, -16 source bytes, and +5 source files. Final framework archive
`docs/benchmark/sweeps/platformer-2026-08-07-50` passes sealed proof 2/2; final blind judge is
`docs/verification/blind-platformer-round-1-final13/judge.json`. The cost result is based on
measured source LOC/bytes only; no model-token savings are claimed.

Contract conformance: prd_contract: v1
