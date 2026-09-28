# PRD-462: Make the colour-batch lane's per-frame sync as cheap as the shared-material lane

**Status:** NOT STARTED — re-scoped 2026-09-28; the change notification it was first filed for is reverted (see ## Decisions).
**Date:** 2026-09-28
**Target branch:** `develop`
**Owner request:** close the last row where Godot beats ThreeNative on the PRD-449 scoreboard, the same way a real game benefits.

## Problem

A settled L4@4,096 frame on the quiet machine is **10.0 ms**, of which the render projection's per-frame reconcile (`collapseMs`) is **7.53 ms** — 75% of the whole frame. The shared-material lane, L3, does the equivalent reconcile over the *same* 4,096 moving cubes (`mutationRate 1`) in **~0.8 ms**. Both lanes are the same projection over the same member count; the colour lane pays roughly ten times the per-frame sync, and that difference — not a drift check — is what the can't-batch row is losing to (Godot 5.95 ms for L4@4,096, 1.73 ms at 1,024, against TN's 7.88 and 2.08).

Where the 7.53 ms goes is not yet attributed. The batched lane pays its mirror's per-instance cost once per batch into one typed array (288198dc5); the uniform lane's `InstancedMesh` path in `packages/core/src/projection-apply.ts` is the suspect — per-member `setMatrixAt`/`compose` writes, a whole `instanceMatrix` re-upload, per-member colour writes and per-member map lookups. Phase 1 measures that before anything is changed.

## Design

Not chosen yet. The mechanisms already in the tree are the candidates: the batched lane's once-per-batch typed-array matrix write, `addUpdateRange` for the `instanceMatrix` upload, and skipping a colour write whose value has not moved. Whichever the profile names is the only thing that ships; a fix that is not the named cost is not the fix.

## Phases

### Phase 1: Attribute the reconcile

- [ ] One CPU harness measures both lanes' per-frame reconcile at 4,096 moving members, with no GPU in the loop. proof: `node --import tsx --cpu-prof packages/core/__tests__/prd-462-reconcile-profile.ts`, profiles in `artifacts/engine-load-test/prd-449/tmp/attribution/uniform-lane/`, and both lanes' per-frame ms written on this line.
- [ ] The dominant self-time functions are named per lane, with the ms each carries. proof: the top self-time table from those two profiles, quoted on this line with the root cause it points at.

### Phase 2: Fix the named cost at the root

- [ ] The smallest diff in `packages/core` that removes the named cost, measured in the same CPU harness. proof: the diff, and the harness's before/after per-frame ms for the uniform lane with the number of files and lines it touched.
- [ ] Every projection spec stays green. proof: `pnpm exec vitest run packages/core/__tests__/projection-uniform-batch.spec.ts packages/core/__tests__/projection-hot-path.spec.ts packages/core/__tests__/constraints.spec.ts`, row counts and exit code.
- [ ] The full core suite has no new failure against `origin/develop`, named rather than counted. proof: `pnpm --filter @threenative/core exec vitest run` with both failure sets written out.
- [ ] Root `pnpm typecheck` and `pnpm lint` exit 0 and `pnpm quality` adds no suppression. proof: the three commands with their exit codes and `pnpm quality`'s suppression line.

### Phase 3: Prove it on the GPU, quiet machine only

- [ ] L4@4,096's median frame time improves by more than the pair spread, and L3 regresses by less than its spread. proof: eight runs B A B A B A B A — `pnpm bench:engines --arm tn-desktop --ladder 1024,4096 --modes L3,L4 --frames 400 --warmup 100 --repeats 1 --skip-baseline --out prd-449/pilots/tn-ulane-<before|after>-<n>-2026-09-28`, `uptime` 1-minute load under 10 before every one of them, `identity.sourceSha` in every JSON, and the paired table on this line. If it does not clear that bar the fix is reverted and the PRD says so.

## Acceptance criteria

- [ ] The can't-batch row is a TN win or a tie, and every other row stays a TN win or tie. proof: `pnpm bench:scoreboard <tag>` on a quiet machine, with the row verdicts written on this line. — A scoreboard at load 100 publishes a verdict the machine did not produce; `uptime` read 10.81, 73.78 then 102.61 across three attempts on 2026-09-28, so this runs only under the load-10 bar the phase 3 box sets.

## Decisions

**Site page waits for this PRD — owner, 2026-09-28.** The public benchmarks page on threenative-site ships once TN beats Godot on the can't-batch row, with charts and a "run it yourself" guide.

**Change notification rejected; code reverted — owner rule (no benchmaxxing, kill switch), 2026-09-28.** The quiet-machine A/B in `4ba74c9c5` (`tn-notify-quiet-{before,after}-{1..4}-2026-09-28.json`, load 3.35–4.77, B A B A B A B A, `--frames 400 --warmup 250`) put L4@4,096 at **+0.33 ms median** against a **1.68 ms** spread between two runs of the *same* build, with half the pairs pointing the other way; L3 moved +0.07 and +0.01, inside its own spread. A frame that a different mechanism already dominates cannot be won by a cheaper drift check, so `bd88d3682` is reverted and the per-frame poll stays. What it had built, and why none of it stays ticked: the watch/dirty-check/restore in `projection-uniform.ts` with release on every `projection-apply.ts` exit path, the budgeted sliced install that fell back to the exact poll, the row that a watched material keeps the fingerprint it was classified with so one drifting member stops re-deriving 4,096 of them (14 existing `projection-uniform-batch.spec.ts` rows plus 7 new, all green here), and the projection on/off pixel match at `?rung=uniform&count=4096` — `compareCaptures` 0 pixel mismatch, ΔE 0, byte-identical on the RTX 2080 at the one-tick and 140-tick settles. The isolated win is real and is the premise this PRD now attacks from the other end: 1.04 µs polled against 0.23 µs watched at 4,096 members, and worth ~0 ms in a frame. Three gaps the mechanism accepted and this PRD inherits as unproven: `delete material.<key>` and `Object.freeze` on a batched material, and a property added to a watched material.

**The row's remaining gap is inside the projection's own 7.5 ms — 2026-09-28.** The host-gap split (`tn-notify-quiet-hostgap-settled-2026-09-28.json`, `TN_HOST_GAP_DETAIL=1`) closed the earlier guess: a 10.03 ms period is 9.10 ms inside the rAF callback — 7.53 of it the reconcile, 0.69 the game transform loop, 0.88 three.js render and submit — against 0.63 ms of native replay (6%), 0.10 present and 0.18 of everything else. There is no ~7 ms of L4@4,096 hiding outside the reconcile to find, which is why phase 1 profiles the reconcile itself.
