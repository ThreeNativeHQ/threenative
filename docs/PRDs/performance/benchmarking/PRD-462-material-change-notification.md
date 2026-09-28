# PRD-462: Material change notification instead of per-frame polling

**Status:** NOT STARTED
**Date:** 2026-09-28
**Target branch:** `develop`
**Owner request:** close the last row where Godot beats ThreeNative on the PRD-449 scoreboard, the same way a real game benefits.

## Problem

The render projection batches meshes whose materials differ only in colour into one instanced draw (`packages/core/src/projection-uniform.ts`). To honour "the game may change anything at any time", it polls every distinct member material every frame. That costs about 0.69 µs per material, or 2.8 ms at 4,096 materials, and it accounts for all of the remaining can't-batch gap. On the 2026-09-28 scoreboard, L4 ran 7.88 ms for TN against 5.95 ms for Godot at 4,096 cubes, and 2.08 against 1.73 ms at 1,024. A build without the check runs L4 at 4,096 in 2.8 ms. Agent-written games often create one material per object, so this is a real pattern, not a benchmark shape.

## Design (measured in a scratch micro-bench, 2026-09-28)

When a material joins a uniform batch, its watched own properties become accessor pairs that set a dirty bit on write. There is one shared accessor pair per key name, with values kept in a non-enumerable symbol store. The per-frame check becomes: dirty bit, then a component compare of the few object-valued fields (`Color`/`Vector2`/`Euler`), then the `defines` walk. That measured 0.056 µs per material, against 0.69 today. `onBeforeCompile` and `customProgramCacheKey` are watched by name. A material leaving the batch, or the batch being released, restores its plain data properties. The drawn material is the mirror's own plain clone, so three.js's draw path never reads a watched object.

- **Install cost:** about 32 µs per material, or 130 ms for 4,096. Watchers install in slices under a per-frame budget, and a member not yet watched stays on today's exact poll, so detection never lapses.
- **Game-side cost:** a watched material reads in about 24 ns instead of 1.5 ns, and writes in about 110 ns instead of 1 ns. This is off the draw path.
- **Accepted gaps (no guard row covers them today):** `delete material.<watched key>` and `Object.freeze` on a batched material. Both are recorded here and not silently claimed.

## Phases

### Phase 1: Change notification with the same guarantees

- [ ] Watch, dirty-check and restore in `projection-uniform.ts`, with release on every `projection-apply.ts` exit path (material swap, release, batch dispose, `releaseAll`). proof: the 14 existing `projection-uniform-batch.spec.ts` rows stay green; new rows red→green for `onBeforeCompile` and `customProgramCacheKey` assignment ejecting a member, data properties restored after ejection and after `releaseAll`, and a shared-lane material never watched.
- [ ] Budgeted, sliced install that falls back to the exact poll for members not yet watched. proof: a spec shows a member edited before its watcher installs is still ejected the same frame, and no frame installs past the budget.
- [ ] Core suite has no new failures. proof: `pnpm --filter @threenative/core exec vitest run`, compared with the known pre-existing set.

### Phase 2: Prove it on the GPU and on a real game

- [ ] Paired A/B of L4 and L3 at 1,024 and 4,096 on the RTX 2080. proof: `tn-desktop` runs B A B A B A with source hashes in each JSON, and L3 does not regress.
- [ ] Projection on/off pixel match for L4. proof: `examples/engine-load-test` projection-conformance `?rung=uniform&count=4096` compared within the registry tolerance.
- [ ] Real-game holdout shows no regression. proof: racing and shooter template before/after, as in PRD-449.
- [ ] Scoreboard rerun. proof: `pnpm bench:scoreboard <tag>` on a quiet machine, with the can't-batch row verdicts recorded here.

## Acceptance criteria

- [ ] The can't-batch rows are no longer Godot wins on the scoreboard, and every other row stays a TN win or tie. proof: the scoreboard JSONs and the report banner.

## Decisions

**Site page waits for this PRD — owner, 2026-09-28.** The public benchmarks page on threenative-site ships once TN beats Godot on the can't-batch row, with charts and a "run it yourself" guide.
